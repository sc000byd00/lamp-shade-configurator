import type { ShadeParams } from './params'
import { resolutionFor } from './params'
import { profileRadius, profileSlope } from './profile'
import { LITHO_BAND, makePattern, patternMovesWall, type LumaImage } from './pattern'

/**
 * Closed, outward-oriented triangle mesh of the shade. Z is up, units are mm,
 * the bottom of the shade sits on z = 0 (print orientation).
 */
export interface ShadeMesh {
  positions: Float32Array
  indices: Uint32Array
  /** Wall thickness normal to the surface at each vertex, mm (used for the light preview). */
  thickness: Float32Array
  /** Smallest wall thickness found on the patterned wall, mm. */
  minWall: number
  /** Largest outer radius, mm. */
  maxRadius: number
  /** Smallest inner radius above the bottom plate, mm. */
  minInnerRadius: number
  /** Inner radius right above the bottom plate, mm. */
  innerRadiusAtPlate: number
}

const TAU = Math.PI * 2

export function buildShade(p: ShadeParams, image?: LumaImage): ShadeMesh {
  const { segments: N, rows: M } = resolutionFor(p)
  const field = makePattern(p, image)
  const moves = patternMovesWall(p)
  const H = p.height
  const plate = p.fitting === 'plate'
  const zp = plate ? p.plateThickness : 0
  const [b0, b1] = LITHO_BAND

  /** cos of the wall angle against vertical, from the plain profile. */
  const cosAt = (t: number) => 1 / Math.sqrt(1 + profileSlope(p, t) ** 2)

  /** Outer and inner radius at (theta, t). Both surfaces are evaluated at the same t. */
  const radii = (th: number, t: number): [number, number] => {
    const R = profileRadius(p, t)
    const c = cosAt(t)
    const d = field.at(th, t)
    if (p.pattern === 'lithophane') {
      const inBand = t >= b0 && t <= b1
      const wall = inBand ? p.lithoMin + d : p.wall
      return [R + wall / c, R]
    }
    if (moves) {
      const o = R + d
      return [o, o - p.wall / c]
    }
    return [R + d, R - p.wall / c]
  }

  // Vertex layout: outer rings 0..M, inner rings 0..M, then the hole rings when there is a plate.
  const ringCount = 2 * (M + 1) + (plate ? 2 : 0)
  const vCount = ringCount * N
  const pos = new Float32Array(vCount * 3)
  const thick = new Float32Array(vCount)
  const cosT = new Float64Array(N)
  const sinT = new Float64Array(N)
  for (let j = 0; j < N; j++) {
    cosT[j] = Math.cos((TAU * j) / N)
    sinT[j] = Math.sin((TAU * j) / N)
  }

  const outerIdx = (i: number, j: number) => i * N + (j % N)
  const innerIdx = (i: number, j: number) => (M + 1 + i) * N + (j % N)
  const holeBottomIdx = (j: number) => 2 * (M + 1) * N + (j % N)
  const holeTopIdx = (j: number) => (2 * (M + 1) + 1) * N + (j % N)

  const setV = (k: number, r: number, j: number, z: number) => {
    pos[3 * k] = r * cosT[j]
    pos[3 * k + 1] = r * sinT[j]
    pos[3 * k + 2] = z
  }

  let minWall = Infinity
  let maxRadius = 0
  let minInner = Infinity
  let innerAtPlate = Infinity
  const dth = TAU / N
  const dt = 1 / M

  // Outer surface and the thickness estimate.
  for (let i = 0; i <= M; i++) {
    const t = i / M
    const z = t * H
    for (let j = 0; j < N; j++) {
      const th = j * dth
      const [ro, ri] = radii(th, t)
      setV(outerIdx(i, j), ro, j, z)
      maxRadius = Math.max(maxRadius, ro)
      // Normal thickness: radial gap reduced by the tilt of the outer surface.
      const drdth = (radii(th + dth, t)[0] - radii(th - dth, t)[0]) / (2 * dth * ro)
      const tm = Math.max(0, t - dt)
      const tp = Math.min(1, t + dt)
      const drdz = (radii(th, tp)[0] - radii(th, tm)[0]) / ((tp - tm) * H)
      const tilt = 1 / Math.sqrt(1 + drdth * drdth + drdz * drdz)
      const tn = (ro - ri) * tilt
      thick[outerIdx(i, j)] = tn
      if (t > 0.02 && t < 0.98) minWall = Math.min(minWall, tn)
    }
  }

  // Inner surface: starts on top of the plate.
  for (let i = 0; i <= M; i++) {
    const z = zp + (i / M) * (H - zp)
    const t = z / H
    for (let j = 0; j < N; j++) {
      const [ro, ri] = radii(j * dth, t)
      setV(innerIdx(i, j), ri, j, z)
      thick[innerIdx(i, j)] = (ro - ri) * cosAt(t)
      minInner = Math.min(minInner, ri)
      if (i === 0) innerAtPlate = Math.min(innerAtPlate, ri)
    }
  }

  if (plate) {
    const h = p.holeDiameter / 2
    for (let j = 0; j < N; j++) {
      setV(holeBottomIdx(j), h, j, 0)
      setV(holeTopIdx(j), h, j, zp)
      thick[holeBottomIdx(j)] = zp
      thick[holeTopIdx(j)] = zp
    }
  }

  // Faces.
  const triCount = 2 * N * (2 * M + 2) + (plate ? 4 * N : 0)
  const idx = new Uint32Array(triCount * 3)
  let w = 0
  const tri = (a: number, b: number, c: number) => {
    idx[w++] = a
    idx[w++] = b
    idx[w++] = c
  }

  for (let i = 0; i < M; i++) {
    for (let j = 0; j < N; j++) {
      // Outer wall, normal points away from the axis.
      const a = outerIdx(i, j)
      const b = outerIdx(i, j + 1)
      const c = outerIdx(i + 1, j + 1)
      const d = outerIdx(i + 1, j)
      tri(a, b, c)
      tri(a, c, d)
      // Inner wall, normal points to the axis.
      const ia = innerIdx(i, j)
      const ib = innerIdx(i, j + 1)
      const ic = innerIdx(i + 1, j + 1)
      const id = innerIdx(i + 1, j)
      tri(ia, ic, ib)
      tri(ia, id, ic)
    }
  }
  for (let j = 0; j < N; j++) {
    // Top rim, normal +z.
    const o = outerIdx(M, j)
    const o1 = outerIdx(M, j + 1)
    const n = innerIdx(M, j)
    const n1 = innerIdx(M, j + 1)
    tri(o, o1, n1)
    tri(o, n1, n)
    if (plate) {
      const ob = outerIdx(0, j)
      const ob1 = outerIdx(0, j + 1)
      const hb = holeBottomIdx(j)
      const hb1 = holeBottomIdx(j + 1)
      const ht = holeTopIdx(j)
      const ht1 = holeTopIdx(j + 1)
      const ib = innerIdx(0, j)
      const ib1 = innerIdx(0, j + 1)
      // Bottom face on the print bed, normal -z.
      tri(ob, hb1, ob1)
      tri(ob, hb, hb1)
      // Top of the plate, normal +z.
      tri(ib, ib1, ht1)
      tri(ib, ht1, ht)
      // Hole wall, normal to the axis.
      tri(hb, ht1, hb1)
      tri(hb, ht, ht1)
    } else {
      // Open bottom rim, normal -z.
      const ob = outerIdx(0, j)
      const ob1 = outerIdx(0, j + 1)
      const ib = innerIdx(0, j)
      const ib1 = innerIdx(0, j + 1)
      tri(ob, ib1, ob1)
      tri(ob, ib, ib1)
    }
  }

  return {
    positions: pos,
    indices: w === idx.length ? idx : idx.slice(0, w),
    thickness: thick,
    minWall,
    maxRadius,
    minInnerRadius: minInner,
    innerRadiusAtPlate: innerAtPlate,
  }
}
