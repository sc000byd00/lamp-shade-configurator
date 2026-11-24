import type { ShadeParams } from './params'

/**
 * Outer radius of the plain shape (before any pattern) at height fraction t in [0, 1].
 */
export function profileRadius(p: ShadeParams, t: number): number {
  const rb = p.radiusBottom
  const rt = p.radiusTop
  let r: number
  switch (p.shape) {
    case 'cylinder':
      r = rb
      break
    case 'cone':
      r = rb + (rt - rb) * t
      break
    case 'globe': {
      // Sphere cut at both ends; the openings follow radiusTop.
      const open = Math.min(rt, rb * 0.9) / rb
      const a = Math.asin(open)
      r = rb * Math.sin(a + t * (Math.PI - 2 * a))
      break
    }
    case 'drop': {
      // Wide round bottom that narrows smoothly into the top opening.
      const s = Math.sin(Math.PI * (0.18 + 0.5 * t))
      const neck = 0.5 - 0.5 * Math.cos(Math.PI * t)
      r = rb * s * (1 - neck) + rt * neck
      break
    }
    case 'bell': {
      const e = Math.pow(1 - t, 2.2)
      r = rt + (rb - rt) * e
      break
    }
  }
  r += p.bulge * rb * Math.sin(Math.PI * t)
  return Math.max(r, 5)
}

/** Slope dr/dz of the plain profile, by central difference. */
export function profileSlope(p: ShadeParams, t: number): number {
  const h = 1e-3
  const t0 = Math.max(0, t - h)
  const t1 = Math.min(1, t + h)
  return (profileRadius(p, t1) - profileRadius(p, t0)) / ((t1 - t0) * p.height)
}
