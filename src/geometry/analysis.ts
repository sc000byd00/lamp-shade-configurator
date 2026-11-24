import type { ShadeMesh } from './shade'

export interface MeshStats {
  /** Volume in mm³. */
  volume: number
  /** Surface area in mm². */
  area: number
  /** Share of the surface (without the bed face) steeper than the overhang limit. */
  overhangShare: number
  /** Steepest overhang found, degrees from vertical. */
  maxOverhang: number
  /** Per-vertex flag 0/1, for the overhang view. */
  overhangVertex: Float32Array
  bboxMin: [number, number, number]
  bboxMax: [number, number, number]
}

/**
 * Volume, area and overhang analysis.
 * @param limitDeg overhang angle from vertical that still prints without support
 */
export function analyse(mesh: ShadeMesh, limitDeg = 50): MeshStats {
  const P = mesh.positions
  const I = mesh.indices
  const limit = -Math.sin((limitDeg * Math.PI) / 180)
  const flag = new Float32Array(P.length / 3)
  let vol = 0
  let area = 0
  let ohArea = 0
  let freeArea = 0
  let minNz = 0
  const bmin: [number, number, number] = [Infinity, Infinity, Infinity]
  const bmax: [number, number, number] = [-Infinity, -Infinity, -Infinity]
  for (let k = 0; k < P.length; k += 3) {
    for (let a = 0; a < 3; a++) {
      bmin[a] = Math.min(bmin[a], P[k + a])
      bmax[a] = Math.max(bmax[a], P[k + a])
    }
  }
  for (let f = 0; f < I.length; f += 3) {
    const a = 3 * I[f]
    const b = 3 * I[f + 1]
    const c = 3 * I[f + 2]
    const ax = P[a], ay = P[a + 1], az = P[a + 2]
    const bx = P[b], by = P[b + 1], bz = P[b + 2]
    const cx = P[c], cy = P[c + 1], cz = P[c + 2]
    // Signed volume of the tetrahedron with the origin.
    vol += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6
    const ux = bx - ax, uy = by - ay, uz = bz - az
    const vx = cx - ax, vy = cy - ay, vz = cz - az
    const nx = uy * vz - uz * vy
    const ny = uz * vx - ux * vz
    const nz = ux * vy - uy * vx
    const len = Math.hypot(nx, ny, nz)
    if (len === 0) continue
    const A = len / 2
    area += A
    // Faces lying on the bed are not overhangs.
    if (az < 1e-6 && bz < 1e-6 && cz < 1e-6) continue
    freeArea += A
    const z = nz / len
    if (z < limit) {
      ohArea += A
      flag[I[f]] = flag[I[f + 1]] = flag[I[f + 2]] = 1
    }
    if (z < minNz) minNz = z
  }
  return {
    volume: vol,
    area,
    overhangShare: freeArea > 0 ? ohArea / freeArea : 0,
    maxOverhang: (Math.asin(Math.min(1, -minNz)) * 180) / Math.PI,
    overhangVertex: flag,
    bboxMin: bmin,
    bboxMax: bmax,
  }
}

export interface EdgeReport {
  /** Edges used by exactly one face pair in opposite directions. */
  ok: boolean
  openEdges: number
  badEdges: number
  degenerateFaces: number
}

/** Watertight and consistently oriented: every directed edge has exactly one reverse partner. */
export function checkEdges(mesh: ShadeMesh): EdgeReport {
  const I = mesh.indices
  const nV = mesh.positions.length / 3
  const directed = new Map<number, number>()
  let degenerate = 0
  const key = (a: number, b: number) => a * nV + b
  for (let f = 0; f < I.length; f += 3) {
    const t = [I[f], I[f + 1], I[f + 2]]
    if (t[0] === t[1] || t[1] === t[2] || t[0] === t[2]) {
      degenerate++
      continue
    }
    for (let e = 0; e < 3; e++) {
      const k = key(t[e], t[(e + 1) % 3])
      directed.set(k, (directed.get(k) ?? 0) + 1)
    }
  }
  let open = 0
  let bad = 0
  for (const [k, n] of directed) {
    if (n !== 1) bad++
    const a = Math.floor(k / nV)
    const b = k - a * nV
    const back = directed.get(key(b, a)) ?? 0
    if (back === 0) open++
    else if (back !== 1) bad++
  }
  return { ok: open === 0 && bad === 0 && degenerate === 0, openEdges: open, badEdges: bad, degenerateFaces: degenerate }
}
