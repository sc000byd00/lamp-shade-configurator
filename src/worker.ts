import { buildShade } from './geometry/shade'
import { analyse } from './geometry/analysis'
import type { ShadeParams } from './geometry/params'
import type { LumaImage } from './geometry/pattern'

export interface BuildRequest {
  id: number
  params: ShadeParams
  image?: LumaImage
  overhangLimit: number
}

export interface BuildResult {
  id: number
  positions: Float32Array
  indices: Uint32Array
  thickness: Float32Array
  overhang: Float32Array
  minWall: number
  maxRadius: number
  minInnerRadius: number
  innerRadiusAtPlate: number
  volume: number
  area: number
  overhangShare: number
  maxOverhang: number
  bboxMin: [number, number, number]
  bboxMax: [number, number, number]
  ms: number
}

self.onmessage = (e: MessageEvent<BuildRequest>) => {
  const t0 = performance.now()
  const { id, params, image, overhangLimit } = e.data
  const mesh = buildShade(params, image)
  const s = analyse(mesh, overhangLimit)
  const res: BuildResult = {
    id,
    positions: mesh.positions,
    indices: mesh.indices,
    thickness: mesh.thickness,
    overhang: s.overhangVertex,
    minWall: mesh.minWall,
    maxRadius: mesh.maxRadius,
    minInnerRadius: mesh.minInnerRadius,
    innerRadiusAtPlate: mesh.innerRadiusAtPlate,
    volume: s.volume,
    area: s.area,
    overhangShare: s.overhangShare,
    maxOverhang: s.maxOverhang,
    bboxMin: s.bboxMin,
    bboxMax: s.bboxMax,
    ms: performance.now() - t0,
  }
  ;(self as unknown as Worker).postMessage(res, [
    res.positions.buffer,
    res.indices.buffer,
    res.thickness.buffer,
    res.overhang.buffer,
  ])
}
