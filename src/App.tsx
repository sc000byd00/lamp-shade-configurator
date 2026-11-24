import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Scene, type ViewState } from './scene/Scene'
import { useShade } from './useShade'
import {
  DEFAULT_PARAMS,
  type FittingKind,
  type MaterialKind,
  type PatternKind,
  type ShadeParams,
  type ShapeKind,
} from './geometry/params'
import type { LumaImage } from './geometry/pattern'
import { MATERIALS, PRINTERS, printHours, runChecks, weightGrams, type Check } from './geometry/checks'
import { checkEdges } from './geometry/analysis'
import { to3mf, toStl } from './geometry/exporters'
import type { ShadeMesh } from './geometry/shade'
import { lithoSize, lumaFromFile, sampleLandscape } from './litho'
import { LOOKS } from './scene/Scene'

const SHAPES: Array<[ShapeKind, string]> = [
  ['drop', 'Drop'],
  ['bell', 'Bell'],
  ['globe', 'Globe'],
  ['cone', 'Cone'],
  ['cylinder', 'Cylinder'],
]

const PATTERNS: Array<[PatternKind, string]> = [
  ['ribs', 'Twisted ribs'],
  ['waves', 'Waves'],
  ['facets', 'Facets'],
  ['voronoi', 'Voronoi'],
  ['lithophane', 'Lithophane'],
  ['none', 'Plain'],
]

const MATS: Array<[MaterialKind, string]> = [
  ['pla-white', 'PLA white'],
  ['petg-natural', 'PETG natural'],
  ['silk-gold', 'Silk gold'],
  ['wood', 'Wood fill'],
]

interface Preset {
  name: string
  params: Partial<ShadeParams>
  view: Partial<ViewState>
}

const PRESETS: Preset[] = [
  {
    name: 'Dune',
    params: { shape: 'drop', pattern: 'ribs', height: 170, radiusBottom: 70, radiusTop: 38, bulge: 0.08, patternCount: 18, patternDepth: 4, twist: 120, wall: 1.6, fitting: 'plate' },
    view: { material: 'pla-white', mount: 'table' },
  },
  {
    name: 'Prism',
    params: { shape: 'cone', pattern: 'facets', height: 150, radiusBottom: 34, radiusTop: 100, bulge: -0.08, patternCount: 14, patternDepth: 5, twist: 0, wall: 1.4, fitting: 'plate', holeDiameter: 42 },
    view: { material: 'silk-gold', mount: 'pendant' },
  },
  {
    name: 'Cells',
    params: { shape: 'globe', pattern: 'voronoi', height: 160, radiusBottom: 82, radiusTop: 46, bulge: 0, patternCount: 14, patternDepth: 1.8, wall: 0.9, seed: 7, fitting: 'plate' },
    view: { material: 'petg-natural', mount: 'table' },
  },
  {
    name: 'Night hills',
    params: { shape: 'cylinder', pattern: 'lithophane', height: 150, radiusBottom: 62, radiusTop: 62, bulge: 0, wall: 1.6, lithoMin: 0.8, lithoMax: 3, fitting: 'plate' },
    view: { material: 'pla-white', mount: 'table', lightOn: true },
  },
]

function Seg<T extends string>({ value, options, onChange }: { value: T; options: Array<[T, string]>; onChange: (v: T) => void }) {
  return (
    <div className="seg" role="radiogroup">
      {options.map(([v, label]) => (
        <button key={v} role="radio" aria-checked={v === value} className={v === value ? 'on' : ''} onClick={() => onChange(v)}>
          {label}
        </button>
      ))}
    </div>
  )
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  unit,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  unit?: string
  onChange: (v: number) => void
}) {
  return (
    <label className="slider">
      <span className="slabel">
        {label}
        <b>
          {Number.isInteger(step) ? value.toFixed(0) : value.toFixed(step < 0.1 ? 2 : 1)}
          {unit ? ` ${unit}` : ''}
        </b>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  )
}

function download(data: Uint8Array, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([data as BlobPart], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

const ICON: Record<Check['status'], string> = { ok: '●', warn: '▲', fail: '■' }

export default function App() {
  const [params, setParams] = useState<ShadeParams>(DEFAULT_PARAMS)
  const [view, setView] = useState<ViewState>({ lightOn: false, showOverhang: false, material: 'pla-white', lightTemp: 'warm', mount: 'table' })
  const [printer, setPrinter] = useState(0)
  const [overhangLimit, setOverhangLimit] = useState(50)
  const [userImage, setUserImage] = useState<File | null>(null)
  const [image, setImage] = useState<LumaImage | undefined>(undefined)
  const [exportNote, setExportNote] = useState<string>('')
  const [panelOpen, setPanelOpen] = useState(true)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  const set = useCallback(<K extends keyof ShadeParams>(k: K, v: ShadeParams[K]) => setParams((p) => ({ ...p, [k]: v })), [])
  const setV = useCallback(<K extends keyof ViewState>(k: K, v: ViewState[K]) => setView((s) => ({ ...s, [k]: v })), [])

  // Lithophane picture follows the band size.
  const size = lithoSize(params)
  const sizeKey = `${size[0]}x${size[1]}`
  useEffect(() => {
    if (params.pattern !== 'lithophane') return
    let cancelled = false
    const make = async () => {
      const img = userImage ? await lumaFromFile(userImage, size) : sampleLandscape(size)
      if (!cancelled) setImage(img)
    }
    make()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.pattern, userImage, sizeKey])

  const { result, working } = useShade(params, params.pattern === 'lithophane' ? image : undefined, overhangLimit)

  const checks = useMemo(() => {
    if (!result) return []
    const mesh: ShadeMesh = {
      positions: result.positions,
      indices: result.indices,
      thickness: result.thickness,
      minWall: result.minWall,
      maxRadius: result.maxRadius,
      minInnerRadius: result.minInnerRadius,
      innerRadiusAtPlate: result.innerRadiusAtPlate,
    }
    return runChecks(
      params,
      mesh,
      {
        volume: result.volume,
        area: result.area,
        overhangShare: result.overhangShare,
        maxOverhang: result.maxOverhang,
        overhangVertex: result.overhang,
        bboxMin: result.bboxMin,
        bboxMax: result.bboxMax,
      },
      PRINTERS[printer],
      overhangLimit,
    )
  }, [result, params, printer, overhangLimit])

  const grams = result ? weightGrams(result.volume, MATERIALS[view.material].density) : 0
  const hours = result ? printHours(result.volume, params.height) : 0

  const applyPreset = (pr: Preset) => {
    setParams((p) => ({ ...p, ...pr.params }))
    setView((v) => ({ ...v, lightOn: false, ...pr.view }))
  }

  const doExport = (kind: 'stl' | '3mf') => {
    if (!result) return
    const mesh: ShadeMesh = {
      positions: result.positions,
      indices: result.indices,
      thickness: result.thickness,
      minWall: result.minWall,
      maxRadius: result.maxRadius,
      minInnerRadius: result.minInnerRadius,
      innerRadiusAtPlate: result.innerRadiusAtPlate,
    }
    const blocking = checks.find((c) => c.status === 'fail' && (c.id === 'hole' || c.id === 'bed'))
    if (blocking) {
      setExportNote(`Not exported: ${blocking.label.toLowerCase()} check failed.`)
      return
    }
    const edges = checkEdges(mesh)
    if (!edges.ok) {
      setExportNote(`Mesh check failed (${edges.openEdges} open, ${edges.badEdges} bad edges). Not exported.`)
      return
    }
    const name = `lamp-shade-${params.shape}-${params.pattern}`
    if (kind === 'stl') download(toStl(mesh, name), `${name}.stl`, 'model/stl')
    else
      download(
        to3mf(mesh, {
          name,
          colorHex: LOOKS[view.material].color,
          metadata: { Description: checks.map((c) => `${c.label}: ${c.status} - ${c.detail}`).join(' | ') },
        }),
        `${name}.3mf`,
        'model/3mf',
      )
    setExportNote(`Watertight, ${(mesh.indices.length / 3).toLocaleString('en-US')} triangles, exported.`)
  }

  const shot = () => {
    const c = canvasRef.current
    if (!c) return
    c.toBlob((b) => {
      if (!b) return
      b.arrayBuffer().then((buf) => download(new Uint8Array(buf), `lamp-shade-${Date.now()}.png`, 'image/png'))
    }, 'image/png')
  }

  const plate = params.fitting === 'plate'
  const litho = params.pattern === 'lithophane'

  return (
    <div className="app">
      <header>
        <div className="brand">
          <span className="logo" aria-hidden>◐</span>
          <div>
            <h1>Lamp Shade Configurator</h1>
            <p>Parametric, print-ready, checked before you download.</p>
          </div>
        </div>
        <div className="actions">
          <button className="ghost" onClick={shot} title="Save the current view as PNG">Snapshot</button>
          <button onClick={() => doExport('stl')} disabled={!result}>STL</button>
          <button className="primary" onClick={() => doExport('3mf')} disabled={!result}>Download 3MF</button>
        </div>
      </header>

      <main>
        <aside className={panelOpen ? 'open' : ''}>
          <button className="panel-toggle" onClick={() => setPanelOpen((o) => !o)}>{panelOpen ? 'Hide settings' : 'Settings'}</button>
          <section>
            <h2>Start from</h2>
            <div className="presets">
              {PRESETS.map((p) => (
                <button key={p.name} onClick={() => applyPreset(p)}>{p.name}</button>
              ))}
            </div>
          </section>

          <section>
            <h2>Shape</h2>
            <Seg value={params.shape} options={SHAPES} onChange={(v) => set('shape', v)} />
            <Slider label="Height" value={params.height} min={60} max={250} step={1} unit="mm" onChange={(v) => set('height', v)} />
            <Slider label={params.shape === 'globe' || params.shape === 'drop' ? 'Largest radius' : 'Bottom radius'} value={params.radiusBottom} min={35} max={125} step={1} unit="mm" onChange={(v) => set('radiusBottom', v)} />
            {params.shape !== 'cylinder' && (
              <Slider label="Top radius" value={params.radiusTop} min={20} max={125} step={1} unit="mm" onChange={(v) => set('radiusTop', v)} />
            )}
            <Slider label="Belly" value={params.bulge} min={-0.2} max={0.4} step={0.01} onChange={(v) => set('bulge', v)} />
          </section>

          <section>
            <h2>Surface</h2>
            <Seg value={params.pattern} options={PATTERNS} onChange={(v) => set('pattern', v)} />
            {!litho && params.pattern !== 'none' && (
              <>
                <Slider label="Repeats" value={params.patternCount} min={3} max={40} step={1} onChange={(v) => set('patternCount', v)} />
                <Slider label="Depth" value={params.patternDepth} min={0.5} max={10} step={0.1} unit="mm" onChange={(v) => set('patternDepth', v)} />
              </>
            )}
            {(params.pattern === 'ribs' || params.pattern === 'waves' || params.pattern === 'facets') && (
              <Slider label="Twist" value={params.twist} min={-360} max={360} step={5} unit="°" onChange={(v) => set('twist', v)} />
            )}
            {params.pattern === 'voronoi' && (
              <Slider label="Seed" value={params.seed} min={1} max={99} step={1} onChange={(v) => set('seed', v)} />
            )}
            {litho && (
              <>
                <label className="upload">
                  <input type="file" accept="image/*" onChange={(e) => setUserImage(e.target.files?.[0] ?? null)} />
                  <span>{userImage ? userImage.name : 'Upload your photo (stays in your browser)'}</span>
                </label>
                {userImage && <button className="link" onClick={() => setUserImage(null)}>Use the sample picture</button>}
                <Slider label="Thinnest (light areas)" value={params.lithoMin} min={0.6} max={1.5} step={0.1} unit="mm" onChange={(v) => set('lithoMin', v)} />
                <Slider label="Thickest (dark areas)" value={params.lithoMax} min={2} max={4} step={0.1} unit="mm" onChange={(v) => set('lithoMax', v)} />
              </>
            )}
            <Slider label={litho ? 'Frame wall' : 'Wall'} value={params.wall} min={0.6} max={3} step={0.1} unit="mm" onChange={(v) => set('wall', v)} />
          </section>

          <section>
            <h2>Fitting</h2>
            <Seg<FittingKind> value={params.fitting} options={[['plate', 'Lamp holder plate'], ['open', 'Open (LED puck)']]} onChange={(v) => set('fitting', v)} />
            {plate && (
              <>
                <Seg value={view.mount} options={[['table', 'Table lamp'], ['pendant', 'Pendant']]} onChange={(v) => setV('mount', v)} />
                <Slider label="Holder hole Ø" value={params.holeDiameter} min={20} max={60} step={0.5} unit="mm" onChange={(v) => set('holeDiameter', v)} />
                <Slider label="Plate" value={params.plateThickness} min={1.6} max={4} step={0.2} unit="mm" onChange={(v) => set('plateThickness', v)} />
                <p className="hint">Measure the thread of your lamp holder and set the hole a little larger.</p>
              </>
            )}
          </section>

          <section>
            <h2>Material &amp; light</h2>
            <Seg value={view.material} options={MATS} onChange={(v) => setV('material', v)} />
            <Seg value={view.lightTemp} options={[['warm', '2700 K'], ['neutral', '4000 K']]} onChange={(v) => setV('lightTemp', v)} />
          </section>

          <section>
            <h2>Printer</h2>
            <select value={printer} onChange={(e) => setPrinter(Number(e.target.value))}>
              {PRINTERS.map((p, i) => (
                <option key={p.name} value={i}>{p.name}</option>
              ))}
            </select>
            <Slider label="Overhang limit" value={overhangLimit} min={35} max={65} step={1} unit="°" onChange={setOverhangLimit} />
          </section>
        </aside>

        <div className="stage">
          <Scene result={result} params={params} view={view} onCanvas={(c) => (canvasRef.current = c)} />
          <div className="toolbar">
            <button className={view.lightOn ? 'on' : ''} onClick={() => setV('lightOn', !view.lightOn)} aria-pressed={view.lightOn}>
              {view.lightOn ? 'Light on' : 'Light off'}
            </button>
            <button className={view.showOverhang ? 'on' : ''} onClick={() => setV('showOverhang', !view.showOverhang)} aria-pressed={view.showOverhang}>
              Overhangs
            </button>
            {working && <span className="busy">updating…</span>}
          </div>
          <div className="report">
            <div className="stats">
              <div><b>{grams.toFixed(0)} g</b><span>{MATERIALS[view.material].label}</span></div>
              <div><b>≈ {hours.toFixed(1)} h</b><span>print time, 0.2 mm</span></div>
              <div><b>{result ? ((result.indices.length / 3) / 1000).toFixed(0) + 'k' : '–'}</b><span>triangles</span></div>
            </div>
            <ul className="checks">
              {checks.map((c) => (
                <li key={c.id} className={c.status}>
                  <span className="ic">{ICON[c.status]}</span>
                  <div>
                    <b>{c.label}</b>
                    <span>{c.detail}</span>
                  </div>
                </li>
              ))}
            </ul>
            {exportNote && <p className="note">{exportNote}</p>}
          </div>
        </div>
      </main>
    </div>
  )
}
