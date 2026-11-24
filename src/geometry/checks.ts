import type { ShadeParams } from './params'
import type { ShadeMesh } from './shade'
import type { MeshStats } from './analysis'

export type Status = 'ok' | 'warn' | 'fail'

export interface Check {
  id: string
  label: string
  status: Status
  detail: string
}

export interface PrinterProfile {
  name: string
  bed: [number, number, number]
}

export const PRINTERS: PrinterProfile[] = [
  { name: 'Bambu Lab A1 / P1 / X1 (256 mm)', bed: [256, 256, 256] },
  { name: 'Prusa MK4 (250 × 210 × 220 mm)', bed: [250, 210, 220] },
  { name: 'Bambu Lab A1 mini (180 mm)', bed: [180, 180, 180] },
]

export interface MaterialInfo {
  label: string
  /** g/cm³ */
  density: number
}

export const MATERIALS: Record<string, MaterialInfo> = {
  'pla-white': { label: 'PLA white', density: 1.24 },
  'petg-natural': { label: 'PETG natural', density: 1.27 },
  'silk-gold': { label: 'Silk PLA gold', density: 1.24 },
  wood: { label: 'Wood-fill PLA', density: 1.15 },
}

const f1 = (x: number) => x.toFixed(1)

export function runChecks(
  p: ShadeParams,
  mesh: ShadeMesh,
  stats: MeshStats,
  printer: PrinterProfile,
  overhangLimit: number,
): Check[] {
  const out: Check[] = []
  const dx = stats.bboxMax[0] - stats.bboxMin[0]
  const dy = stats.bboxMax[1] - stats.bboxMin[1]
  const dz = stats.bboxMax[2] - stats.bboxMin[2]
  const [bx, by, bz] = printer.bed
  const fits = dz <= bz && ((dx <= bx && dy <= by) || (dx <= by && dy <= bx))
  out.push({
    id: 'bed',
    label: 'Fits the build plate',
    status: fits ? 'ok' : 'fail',
    detail: `${f1(dx)} × ${f1(dy)} × ${f1(dz)} mm on ${printer.name}`,
  })

  const wallMin = p.pattern === 'lithophane' ? Math.min(p.lithoMin, p.wall) : mesh.minWall
  out.push({
    id: 'wall',
    label: 'Wall thickness',
    status: wallMin < 0.6 ? 'fail' : wallMin < 0.8 ? 'warn' : 'ok',
    detail:
      `thinnest ${f1(wallMin)} mm` +
      (wallMin < 0.8 ? ' (below two 0.4 mm lines; raise wall or lower pattern depth)' : ' (at least two 0.4 mm lines)'),
  })

  const share = stats.overhangShare * 100
  out.push({
    id: 'overhang',
    label: `Overhangs over ${overhangLimit}°`,
    status: share < 0.5 ? 'ok' : share < 5 ? 'warn' : 'fail',
    detail:
      share < 0.05
        ? `none, steepest ${f1(stats.maxOverhang)}° from vertical; prints without support`
        : `${f1(share)} % of the surface, steepest ${f1(stats.maxOverhang)}°; check in the overhang view`,
  })

  if (p.fitting === 'plate') {
    const margin = mesh.innerRadiusAtPlate - p.holeDiameter / 2
    out.push({
      id: 'hole',
      label: 'Lamp holder hole',
      status: margin < 2 ? 'fail' : margin < 6 ? 'warn' : 'ok',
      detail: `Ø ${f1(p.holeDiameter)} mm, ${f1(margin)} mm plate ring left to the wall. Measure the holder before printing.`,
    })
  }

  out.push({
    id: 'heat',
    label: 'Bulb clearance',
    status: mesh.minInnerRadius < 30 ? 'warn' : 'ok',
    detail: `narrowest inside radius ${f1(mesh.minInnerRadius)} mm. LED bulbs only: PLA softens at about 60 °C.`,
  })

  return out
}

export function weightGrams(volumeMm3: number, density: number): number {
  return (volumeMm3 / 1000) * density
}

/** Very rough: walls print at about 12 mm³/s on a current bed slinger, plus travel and layer changes. */
export function printHours(volumeMm3: number, heightMm: number, layer = 0.2): number {
  const extrude = volumeMm3 / 12
  const layers = heightMm / layer
  return (extrude + layers * 4) / 3600
}
