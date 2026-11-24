import { describe, expect, it } from 'vitest'
import { unzipSync, strFromU8 } from 'fflate'
import { DEFAULT_PARAMS, resolutionFor, type PatternKind, type ShadeParams, type ShapeKind } from './params'
import { buildShade } from './shade'
import { analyse, checkEdges } from './analysis'
import { to3mf, toStl } from './exporters'
import type { LumaImage } from './pattern'

const shapes: ShapeKind[] = ['cylinder', 'cone', 'globe', 'drop', 'bell']
const patterns: PatternKind[] = ['none', 'ribs', 'waves', 'facets', 'voronoi', 'lithophane']

function gradient(w = 64, h = 32): LumaImage {
  const data = new Float32Array(w * h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data[y * w + x] = x / (w - 1)
  return { width: w, height: h, data }
}

function small(p: Partial<ShadeParams>): ShadeParams {
  return { ...DEFAULT_PARAMS, segments: 96, rows: 48, ...p }
}

describe('shade mesh', () => {
  for (const shape of shapes) {
    for (const pattern of patterns) {
      for (const fitting of ['plate', 'open'] as const) {
        it(`${shape} / ${pattern} / ${fitting} is closed and outward`, () => {
          const p = small({ shape, pattern, fitting })
          const mesh = buildShade(p, gradient())
          const edges = checkEdges(mesh)
          expect(edges).toEqual({ ok: true, openEdges: 0, badEdges: 0, degenerateFaces: 0 })
          const s = analyse(mesh)
          expect(s.volume).toBeGreaterThan(0)
          expect(s.bboxMin[2]).toBeCloseTo(0, 5)
          expect(s.bboxMax[2]).toBeCloseTo(p.height, 3)
        })
      }
    }
  }

  it('plain cylinder volume matches the formula', () => {
    const p = small({ shape: 'cylinder', pattern: 'none', fitting: 'open', bulge: 0, radiusBottom: 50, wall: 2, height: 100, segments: 720 })
    const s = analyse(buildShade(p))
    const exact = Math.PI * (50 ** 2 - 48 ** 2) * 100
    expect(Math.abs(s.volume - exact) / exact).toBeLessThan(0.002)
  })

  it('wall thickness stays at the set value for a patterned shell', () => {
    const p = small({ shape: 'cylinder', bulge: 0, pattern: 'ribs', patternDepth: 2, patternCount: 12, wall: 1.6, segments: 480, rows: 96 })
    const mesh = buildShade(p)
    // Rib flanks thin the wall a little, never below ~70 % for these settings.
    expect(mesh.minWall).toBeGreaterThan(1.1)
    expect(mesh.minWall).toBeLessThanOrEqual(1.6 + 1e-6)
  })

  it('lithophane: dark pixels make a thicker wall than light ones', () => {
    const p = small({ shape: 'cylinder', bulge: 0, pattern: 'lithophane', lithoMin: 0.8, lithoMax: 3, segments: 256, rows: 128 })
    const mesh = buildShade(p, gradient())
    const { segments: N, rows: M } = resolutionFor(p)
    const mid = Math.round(M / 2) * N
    // Gradient runs black (u = 0) to white (u -> 1) around the shade.
    const dark = mesh.thickness[mid + Math.round(N * 0.05)]
    const light = mesh.thickness[mid + Math.round(N * 0.95)]
    expect(dark).toBeGreaterThan(2.6)
    expect(light).toBeLessThan(1.1)
    expect(light).toBeGreaterThan(0.75)
  })

  it('overhang check flags a shade that narrows sharply', () => {
    const flat = analyse(buildShade(small({ shape: 'cylinder', pattern: 'none', bulge: 0 })))
    expect(flat.overhangShare).toBe(0)
    const globe = analyse(buildShade(small({ shape: 'globe', pattern: 'none', radiusBottom: 90, radiusTop: 20 })))
    expect(globe.overhangShare).toBeGreaterThan(0.05)
  })
})

describe('export', () => {
  const mesh = buildShade(small({}))
  it('binary STL has the right size', () => {
    const stl = toStl(mesh)
    expect(stl.length).toBe(84 + 50 * (mesh.indices.length / 3))
  })
  it('3MF unzips to a model with all vertices and triangles', () => {
    const zip = unzipSync(to3mf(mesh, { name: 'Test shade', colorHex: '#F4EFE6' }))
    expect(Object.keys(zip).sort()).toEqual(['3D/3dmodel.model', '[Content_Types].xml', '_rels/.rels'])
    const xml = strFromU8(zip['3D/3dmodel.model'])
    expect((xml.match(/<vertex /g) ?? []).length).toBe(mesh.positions.length / 3)
    expect((xml.match(/<triangle /g) ?? []).length).toBe(mesh.indices.length / 3)
    expect(xml).toContain('unit="millimeter"')
  })
})
