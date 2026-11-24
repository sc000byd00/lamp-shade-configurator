import { useEffect, useMemo } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { ContactShadows, Environment, Lightformer, OrbitControls } from '@react-three/drei'
import { Bloom, EffectComposer, Vignette } from '@react-three/postprocessing'
import * as THREE from 'three'
import type { BuildResult } from '../worker'
import type { MaterialKind, ShadeParams } from '../geometry/params'

export type Mount = 'table' | 'pendant'

export interface ViewState {
  lightOn: boolean
  showOverhang: boolean
  material: MaterialKind
  lightTemp: 'warm' | 'neutral'
  mount: Mount
}

interface MatLook {
  color: string
  roughness: number
  metalness: number
  /** Light falloff through the wall, 1/mm. */
  k: number
  sheen?: number
}

export const LOOKS: Record<MaterialKind, MatLook> = {
  'pla-white': { color: '#f3efe7', roughness: 0.62, metalness: 0, k: 0.95 },
  'petg-natural': { color: '#e8e4d4', roughness: 0.28, metalness: 0, k: 0.55 },
  'silk-gold': { color: '#caa055', roughness: 0.32, metalness: 0.55, k: 1.5, sheen: 1 },
  wood: { color: '#a77a4e', roughness: 0.85, metalness: 0, k: 1.9 },
}

const LIGHT = { warm: '#ffb768', neutral: '#ffe6c8' }

function useShadeGeometry(r: BuildResult | null) {
  return useMemo(() => {
    if (!r) return null
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(r.positions, 3))
    g.setAttribute('aThick', new THREE.BufferAttribute(r.thickness, 1))
    g.setAttribute('aOh', new THREE.BufferAttribute(r.overhang, 1))
    g.setIndex(new THREE.BufferAttribute(r.indices, 1))
    g.computeVertexNormals()
    g.computeBoundingSphere()
    return g
  }, [r])
}

function useShadeMaterial(view: ViewState, flat: boolean, bulbZ: number, reach: number) {
  const uniforms = useMemo(
    () => ({
      uK: { value: 1 },
      uGlow: { value: 0 },
      uGlowColor: { value: new THREE.Color(LIGHT.warm) },
      uShowOh: { value: 0 },
      uBulb: { value: new THREE.Vector3(0, 0, 60) },
      uReach: { value: 80 },
    }),
    [],
  )
  const material = useMemo(() => {
    const m = new THREE.MeshPhysicalMaterial({ side: THREE.FrontSide, shadowSide: THREE.DoubleSide })
    m.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms)
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          '#include <common>\nattribute float aThick;\nattribute float aOh;\nvarying float vThick;\nvarying float vOh;\nvarying vec3 vLocal;',
        )
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvThick = aThick;\nvOh = aOh;\nvLocal = position;')
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          '#include <common>\nuniform float uK;\nuniform float uGlow;\nuniform vec3 uGlowColor;\nuniform float uShowOh;\nuniform vec3 uBulb;\nuniform float uReach;\nvarying float vThick;\nvarying float vOh;\nvarying vec3 vLocal;',
        )
        .replace(
          '#include <color_fragment>',
          '#include <color_fragment>\ndiffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.85, 0.18, 0.12), step(0.5, vOh) * uShowOh);',
        )
        .replace(
          '#include <emissivemap_fragment>',
          [
            '#include <emissivemap_fragment>',
            // Grazing view angles mean a longer path through the wall; light fades away from the bulb.
            'float nl = length(normal) * length(vViewPosition);',
            'float ndv = nl > 1e-8 ? abs(dot(normal, vViewPosition)) / nl : 1.0;',
            'ndv = clamp(ndv, 0.35, 1.0);',
            'float dist = length(vLocal - uBulb) / uReach;',
            'float falloff = 1.0 / (1.0 + dist * dist);',
            'vec3 glow = uGlowColor * uGlow * falloff * exp(-uK * max(vThick, 0.0) / ndv);',
            'totalEmissiveRadiance += clamp(glow, 0.0, 6.0);',
          ].join('\n'),
        )
    }
    m.customProgramCacheKey = () => 'shade-glow'
    return m
  }, [uniforms])

  useEffect(() => {
    const look = LOOKS[view.material]
    material.color.set(look.color)
    material.roughness = look.roughness
    material.metalness = look.metalness
    // With the light on, the inner bulb would draw a sharp highlight on the silhouette; keep the outside matte then.
    const lit = view.lightOn && !view.showOverhang
    material.sheen = lit ? 0 : look.sheen ?? 0
    material.specularIntensity = lit ? 0.05 : 1
    material.sheenColor.set('#fff3d6')
    if (material.flatShading !== flat) {
      material.flatShading = flat
      material.needsUpdate = true
    }
    uniforms.uK.value = look.k
    uniforms.uGlow.value = view.lightOn && !view.showOverhang ? 6 : 0
    uniforms.uGlowColor.value.set(LIGHT[view.lightTemp])
    uniforms.uShowOh.value = view.showOverhang ? 1 : 0
    uniforms.uBulb.value.set(0, 0, bulbZ)
    uniforms.uReach.value = reach
  }, [material, uniforms, view, flat, bulbZ, reach])

  return material
}

const MM = 0.001

/** Shade and lamp hardware. All lamp sizes in mm, scaled to metres. */
function Lamp({ result, params, view }: { result: BuildResult | null; params: ShadeParams; view: ViewState }) {
  const geometry = useShadeGeometry(result)
  const plate = params.fitting === 'plate'
  const pendant = plate && view.mount === 'pendant'
  const H = params.height
  const innerR = result ? result.minInnerRadius : 40
  const bulbR = Math.max(10, Math.min(30, innerR - 8))
  const lightColor = LIGHT[view.lightTemp]

  // Table lamp: base, stem, holder, shade plate on top of the holder.
  const baseH = 22
  const stem = 120
  const plateY = plate ? (pendant ? 0 : baseH + stem) : 0
  const bulbZ = plate ? Math.min(params.plateThickness + 18 + bulbR, H * 0.5) : Math.min(28, H * 0.3)
  const holderR = plate ? params.holeDiameter / 2 - 0.6 : 0
  const material = useShadeMaterial(view, false, bulbZ, Math.max(70, H * 0.6))

  const shadeGroupProps = pendant
    ? { position: [0, 0, 0] as const, rotation: [Math.PI / 2, 0, 0] as const }
    : { position: [0, plateY * MM, 0] as const, rotation: [-Math.PI / 2, 0, 0] as const }

  const lightLocalY = pendant ? -bulbZ : plateY + bulbZ

  // Height of the pendant: shade bottom 120 mm above the table.
  const pendantTop = 120 + H

  const content = (
    <>
      {geometry && (
        <group {...shadeGroupProps} scale={MM}>
          <mesh geometry={geometry} material={material} castShadow receiveShadow />
        </group>
      )}
      {/* Bulb */}
      <mesh position={[0, lightLocalY * MM, 0]}>
        <sphereGeometry args={[bulbR * MM, 32, 16]} />
        <meshStandardMaterial
          color={view.lightOn ? '#ffffff' : '#f4f1ea'}
          emissive={lightColor}
          emissiveIntensity={view.lightOn ? 6 : 0}
          roughness={0.2}
          transparent
          opacity={0.92}
        />
      </mesh>
      {view.lightOn && (
        <pointLight
          position={[0, lightLocalY * MM, 0]}
          color={lightColor}
          intensity={0.9}
          distance={0}
          decay={2}
          castShadow
          shadow-mapSize-width={1024}
          shadow-mapSize-height={1024}
          shadow-bias={-0.0004}
          shadow-normalBias={0.0012}
          shadow-camera-near={0.005}
        />
      )}
      {view.lightOn && (
        // Soft spill standing in for the light scattered through the wall.
        <pointLight position={[0, lightLocalY * MM, 0]} color={lightColor} intensity={0.3} distance={0} decay={2} />
      )}
      {plate && !pendant && (
        <group>
          <mesh position={[0, (baseH / 2) * MM, 0]} castShadow receiveShadow>
            <cylinderGeometry args={[62 * MM, 66 * MM, baseH * MM, 64]} />
            <meshStandardMaterial color="#2b2a28" roughness={0.45} metalness={0.2} />
          </mesh>
          <mesh position={[0, (baseH + stem / 2) * MM, 0]} castShadow>
            <cylinderGeometry args={[5 * MM, 5 * MM, stem * MM, 24]} />
            <meshStandardMaterial color="#b08d57" roughness={0.3} metalness={0.9} />
          </mesh>
          <mesh position={[0, (plateY + 12) * MM, 0]} castShadow>
            <cylinderGeometry args={[holderR * MM, holderR * MM, 34 * MM, 48]} />
            <meshStandardMaterial color="#2b2a28" roughness={0.5} />
          </mesh>
        </group>
      )}
      {pendant && (
        <group>
          <mesh position={[0, -14 * MM, 0]}>
            <cylinderGeometry args={[holderR * MM, holderR * MM, 34 * MM, 48]} />
            <meshStandardMaterial color="#2b2a28" roughness={0.5} />
          </mesh>
          <mesh position={[0, 300 * MM, 0]}>
            <cylinderGeometry args={[2.2 * MM, 2.2 * MM, 600 * MM, 12]} />
            <meshStandardMaterial color="#1d1d1d" roughness={0.6} />
          </mesh>
        </group>
      )}
      {!plate && (
        <mesh position={[0, 6 * MM, 0]} castShadow>
          <cylinderGeometry args={[Math.min(35, innerR - 4) * MM, Math.min(35, innerR - 4) * MM, 12 * MM, 48]} />
          <meshStandardMaterial color="#e9e6e0" roughness={0.6} />
        </mesh>
      )}
    </>
  )

  return pendant ? <group position={[0, pendantTop * MM, 0]}>{content}</group> : <group>{content}</group>
}

function Room({ lightOn }: { lightOn: boolean }) {
  return (
    <>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <circleGeometry args={[0.6, 96]} />
        <meshStandardMaterial color={lightOn ? '#5c4331' : '#b38a60'} roughness={0.5} dithering />
      </mesh>
      <mesh position={[0, 0.6, -0.55]} receiveShadow>
        <planeGeometry args={[3, 1.6]} />
        <meshStandardMaterial color={lightOn ? '#2c2824' : '#ebe5d9'} roughness={0.95} dithering />
      </mesh>
    </>
  )
}

/** Shifts the picture left on wide screens, so the lamp is not hidden by the report card. */
function ViewShift() {
  const { camera, size } = useThree()
  useEffect(() => {
    const cam = camera as THREE.PerspectiveCamera
    if (size.width > 820) cam.setViewOffset(size.width, size.height, 150, 0, size.width, size.height)
    else cam.clearViewOffset()
    cam.updateProjectionMatrix()
  }, [camera, size])
  return null
}

export function Scene({
  result,
  params,
  view,
  onCanvas,
}: {
  result: BuildResult | null
  params: ShadeParams
  view: ViewState
  onCanvas?: (c: HTMLCanvasElement) => void
}) {
  const centreY = params.fitting === 'plate' && view.mount === 'table' ? 142 + params.height / 2 : view.mount === 'pendant' && params.fitting === 'plate' ? 120 + params.height / 2 : params.height / 2
  const night = view.lightOn && !view.showOverhang
  return (
    <Canvas
      shadows
      dpr={[1, 2]}
      camera={{ fov: 30, near: 0.01, far: 20, position: [0.5, 0.46, 0.82] }}
      gl={{ preserveDrawingBuffer: true, antialias: true }}
      onCreated={({ gl }) => onCanvas?.(gl.domElement)}
    >
      <color attach="background" args={[night ? '#14110e' : '#efeae1']} />
      <ViewShift />
      <Environment resolution={256} environmentIntensity={night ? 0.05 : 0.65}>
        <Lightformer form="rect" intensity={3} position={[2, 3, 2]} scale={[3, 2, 1]} target={[0, 0, 0]} />
        <Lightformer form="rect" intensity={1.5} position={[-3, 2, 1]} scale={[2, 3, 1]} target={[0, 0, 0]} />
        <Lightformer form="ring" intensity={1} position={[0, 4, -2]} scale={2} target={[0, 0, 0]} />
      </Environment>
      {!night && (
        <directionalLight
          position={[-1.1, 1.9, 1.3]}
          intensity={2.4}
          color="#fff6ea"
          castShadow
          shadow-mapSize-width={2048}
          shadow-mapSize-height={2048}
          shadow-camera-left={-0.5}
          shadow-camera-right={0.5}
          shadow-camera-top={0.6}
          shadow-camera-bottom={-0.2}
          shadow-bias={-0.0003}
        />
      )}
      <ambientLight intensity={night ? 0.02 : 0.15} />
      <Lamp result={result} params={params} view={night === view.lightOn ? view : { ...view, lightOn: false }} />
      <Room lightOn={night} />
      <ContactShadows position={[0, 0.0005, 0]} scale={0.8} blur={2.4} opacity={night ? 0.2 : 0.45} far={0.3} />
      <OrbitControls
        makeDefault
        target={[0, centreY * MM, 0]}
        minDistance={0.18}
        maxDistance={1.8}
        maxPolarAngle={Math.PI / 2 - 0.02}
        enableDamping
      />
      <EffectComposer multisampling={4}>
        <Bloom intensity={night ? 0.7 : 0} luminanceThreshold={0.85} luminanceSmoothing={0.2} mipmapBlur />
        <Vignette offset={0.3} darkness={night ? 0.55 : 0.25} />
      </EffectComposer>
    </Canvas>
  )
}
