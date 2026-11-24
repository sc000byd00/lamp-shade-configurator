import type { ShadeParams } from './params'

/** Grayscale picture for the lithophane, values 0 (black) to 1 (white), row 0 at the top. */
export interface LumaImage {
  width: number
  height: number
  data: Float32Array
}

/** Whether the pattern moves the whole wall (constant thickness) or only the outside. */
export function patternMovesWall(p: ShadeParams): boolean {
  return p.pattern === 'ribs' || p.pattern === 'waves' || p.pattern === 'facets'
}

/** Lithophane band: picture between these height fractions, plain wall outside. */
export const LITHO_BAND: [number, number] = [0.1, 0.9]

const TAU = Math.PI * 2

function tri(x: number): number {
  // Triangle wave, period 1, range 0..1.
  const f = x - Math.floor(x)
  return 1 - Math.abs(2 * f - 1)
}

function smooth(x: number): number {
  const c = Math.min(1, Math.max(0, x))
  return c * c * (3 - 2 * c)
}

/** Deterministic pseudo-random numbers for the voronoi seeds. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export interface PatternField {
  /** Outward displacement in mm at angle theta (rad) and height fraction t. */
  at(theta: number, t: number): number
}

export function makePattern(p: ShadeParams, image?: LumaImage): PatternField {
  const n = Math.max(1, Math.round(p.patternCount))
  const depth = p.patternDepth
  const twist = (p.twist * Math.PI) / 180
  // Fade the pattern out near both rims, so the rims stay round and clean.
  const fade = (t: number) => smooth(t / 0.06) * smooth((1 - t) / 0.06)

  switch (p.pattern) {
    case 'none':
      return { at: () => 0 }
    case 'ribs':
      return {
        at: (th, t) => {
          const u = (th + twist * t) / TAU
          // Smooth ribs without a crease, so the mesh does not alias along the twist.
          const c = 0.5 - 0.5 * Math.cos(2 * Math.PI * n * u)
          return depth * Math.pow(c, 0.8) * fade(t)
        },
      }
    case 'waves':
      return {
        at: (th, t) => {
          const u = th / TAU
          const w = Math.sin(TAU * (n * u + 0.5 * Math.sin(TAU * (t * 1.5 + (twist / TAU)) )))
          return depth * 0.5 * (1 + w) * fade(t)
        },
      }
    case 'facets':
      return {
        at: (th, t) => {
          const u = (n * th) / TAU
          const rowsPerRepeat = (n * p.height) / (TAU * Math.max(p.radiusBottom, p.radiusTop))
          const v = t * rowsPerRepeat + (twist / TAU) * t
          return depth * 0.5 * (tri(u + v) + tri(u - v)) * fade(t)
        },
      }
    case 'voronoi': {
      const rnd = mulberry32(p.seed * 9973 + 1)
      const rowsCount = Math.max(2, Math.round((n * p.height) / (TAU * p.radiusBottom)))
      const pts: Array<[number, number]> = []
      for (let r = 0; r < rowsCount; r++) {
        for (let c = 0; c < n; c++) {
          pts.push([(c + 0.15 + 0.7 * rnd()) / n, (r + 0.15 + 0.7 * rnd()) / rowsCount])
        }
      }
      // Work in a space where one unit is the same length around and along the height.
      const aspect = p.height / (TAU * p.radiusBottom)
      return {
        at: (th, t) => {
          const u = th / TAU
          let f1 = Infinity
          let f2 = Infinity
          for (const [pu, pv] of pts) {
            let du = Math.abs(u - pu)
            if (du > 0.5) du = 1 - du
            const dv = (t - pv) * aspect
            const d = Math.sqrt(du * du + dv * dv)
            if (d < f1) {
              f2 = f1
              f1 = d
            } else if (d < f2) {
              f2 = d
            }
          }
          // Raised cells with sunken seams; seam width scales with the cell size.
          const edge = (f2 - f1) * n
          return depth * smooth(edge / 0.35) * fade(t)
        },
      }
    }
    case 'lithophane': {
      const span = p.lithoMax - p.lithoMin
      const [b0, b1] = LITHO_BAND
      return {
        at: (th, t) => {
          if (!image || t < b0 || t > b1) return 0
          const u = th / TAU
          const v = 1 - (t - b0) / (b1 - b0)
          const lum = sampleLuma(image, u, v)
          // Dark pixels get a thick wall, light pixels a thin one.
          return (1 - lum) * span
        },
      }
    }
  }
}

/** Bilinear sample, u wraps around, v clamps. */
export function sampleLuma(img: LumaImage, u: number, v: number): number {
  const x = (u - Math.floor(u)) * img.width - 0.5
  const y = Math.min(Math.max(v, 0), 1) * (img.height - 1)
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const fx = x - x0
  const fy = y - y0
  const W = img.width
  const px = (xx: number, yy: number) => {
    const xi = ((xx % W) + W) % W
    const yi = Math.min(Math.max(yy, 0), img.height - 1)
    return img.data[yi * W + xi]
  }
  const a = px(x0, y0) * (1 - fx) + px(x0 + 1, y0) * fx
  const b = px(x0, y0 + 1) * (1 - fx) + px(x0 + 1, y0 + 1) * fx
  return a * (1 - fy) + b * fy
}
