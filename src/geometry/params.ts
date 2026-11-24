export type ShapeKind = 'cylinder' | 'cone' | 'globe' | 'drop' | 'bell'
export type PatternKind = 'none' | 'ribs' | 'waves' | 'facets' | 'voronoi' | 'lithophane'
export type FittingKind = 'plate' | 'open'
export type MaterialKind = 'pla-white' | 'petg-natural' | 'silk-gold' | 'wood'

export interface ShadeParams {
  shape: ShapeKind
  /** Height in mm. */
  height: number
  /** Radius at the bottom (or largest radius for globe and drop), mm. */
  radiusBottom: number
  /** Radius at the top, mm. */
  radiusTop: number
  /** Extra belly, fraction of the bottom radius. */
  bulge: number
  /** Wall thickness measured normal to the wall, mm. */
  wall: number
  pattern: PatternKind
  /** Repeats around the circumference. */
  patternCount: number
  /** Pattern depth, mm. */
  patternDepth: number
  /** Twist over the full height, degrees. */
  twist: number
  /** Seed for the voronoi pattern. */
  seed: number
  /** Lithophane: thinnest and thickest wall, mm. */
  lithoMin: number
  lithoMax: number
  fitting: FittingKind
  /** Diameter of the hole in the bottom plate, mm. */
  holeDiameter: number
  /** Bottom plate thickness, mm. */
  plateThickness: number
  /** Mesh resolution: segments around, rows along the height. */
  segments: number
  rows: number
}

export const DEFAULT_PARAMS: ShadeParams = {
  shape: 'drop',
  height: 170,
  radiusBottom: 70,
  radiusTop: 38,
  bulge: 0.08,
  wall: 1.6,
  pattern: 'ribs',
  patternCount: 18,
  patternDepth: 4,
  twist: 120,
  seed: 7,
  lithoMin: 0.8,
  lithoMax: 3.0,
  fitting: 'plate',
  holeDiameter: 42,
  plateThickness: 2.4,
  segments: 240,
  rows: 160,
}

/** Lithophanes need a finer mesh to show the picture. */
export function resolutionFor(p: ShadeParams): { segments: number; rows: number } {
  if (p.pattern === 'lithophane') {
    const circ = 2 * Math.PI * Math.max(p.radiusBottom, p.radiusTop)
    return {
      segments: clampInt(Math.round(circ / 0.5), 240, 960),
      rows: clampInt(Math.round(p.height / 0.5), 120, 480),
    }
  }
  return { segments: p.segments, rows: p.rows }
}

export function clampInt(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.round(v)))
}
