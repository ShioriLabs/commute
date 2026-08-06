/*
 * Corridor centerlines: the schematic's own drawn line paths, so a route leg
 * traces the corridor instead of cutting a straight chord across the artwork.
 *
 * Everything here is pure planar geometry over polylines in the map's world
 * space (the same 0 0 9513.57 6726.88 viewBox as points.json), deliberately
 * importing nothing from the app so it can be unit-tested without fare or
 * point fixtures.
 *
 * Corridors carry no line identity — the generated file has no id and its
 * artwork colours are duplicated across lines — so a leg is matched to a
 * corridor GEOMETRICALLY, per adjacent stop pair. That is what lets branches,
 * the Cikarang loop and interlined trunks work without any line↔stroke table.
 */

// One drawn corridor: `w` is the artwork stroke width (25 rail, 15 BRT), kept
// only as a coarse class hint for debugging. Points are pre-flattened by the
// build script, so there are no curves to evaluate here.
export interface Corridor {
  w: number
  pts: ReadonlyArray<readonly [number, number]>
}

export interface CorridorsManifest {
  version: string
  corridors: Corridor[]
}

// A corridor with its cumulative arc lengths: cums[i] is the distance from
// pts[0] to pts[i], so cums[last] is the whole polyline's length. Precomputed
// once per model build rather than per stop pair — a route re-scans every
// corridor for each of its pairs.
export interface PreparedCorridor {
  pts: ReadonlyArray<readonly [number, number]>
  cums: Float64Array
}

// Where a point lands on a polyline: perpendicular distance to the closest
// point, and that foot's arc-length parameter along the polyline.
export interface Projection {
  dist: number
  s: number
}

/*
 * Candidate threshold, world units. A station's tap target sits ON its corridor
 * (measured: rail projects at ~0-2 units, BRT median 0.7), and the wrong-stroke
 * rejections are in the hundreds — so this is a wide moat around a tight
 * cluster, not a tuned edge.
 */
export const CORRIDOR_MATCH_MAX_DIST_WORLD = 40

/*
 * Detour rejection. A corridor that passes near both stops can still be the
 * wrong one: it may loop the long way round, or be a parallel line that happens
 * to run close. Measured against all 126 adjacent rail pairs on this map, the
 * worst legitimate curve is 1.42x its straight-line distance, so 2.5x rejects
 * nothing real while still catching a loop arc (which runs to 100x+).
 */
export const CORRIDOR_MATCH_MAX_DETOUR_RATIO = 2.5

// Arc length below which two feet count as the same point, world units. Guards
// the degenerate sub-path (a pair projecting onto one spot) that would emit a
// zero-length segment instead of falling back to a chord.
const MIN_SUBPATH_LENGTH = 0.5

export function prepareCorridor(corridor: Corridor): PreparedCorridor {
  const { pts } = corridor
  const cums = new Float64Array(pts.length)
  for (let i = 1; i < pts.length; i++) {
    cums[i] = cums[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])
  }
  return { pts, cums }
}

export function prepareCorridors(corridors: readonly Corridor[]): PreparedCorridor[] {
  return corridors.filter(c => c.pts.length >= 2).map(prepareCorridor)
}

// Closest point on the polyline to (x, y). Walks every segment: these are tens
// of vertices, and a spatial index would cost more to build per frame than the
// scan saves.
export function projectOntoPolyline(x: number, y: number, corridor: PreparedCorridor): Projection {
  const { pts, cums } = corridor
  let bestDist = Infinity
  let bestS = 0
  for (let i = 0; i < pts.length - 1; i++) {
    const ax = pts[i][0]
    const ay = pts[i][1]
    const dx = pts[i + 1][0] - ax
    const dy = pts[i + 1][1] - ay
    const lenSq = dx * dx + dy * dy
    // Clamped to the segment: an unclamped projection would put the foot on the
    // segment's infinite line, letting a stop match a corridor it only lines up
    // with rather than one it lies on.
    const t = lenSq > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / lenSq)) : 0
    const footX = ax + t * dx
    const footY = ay + t * dy
    const dist = Math.hypot(x - footX, y - footY)
    // Strict <, so the first (lowest arc length) foot wins a tie. A point
    // sitting exactly on a shared vertex is otherwise resolved by iteration
    // order, which would make the same input produce different sub-paths.
    if (dist < bestDist) {
      bestDist = dist
      bestS = cums[i] + t * Math.sqrt(lenSq)
    }
  }
  return { dist: bestDist, s: bestS }
}

/*
 * The stretch of polyline between two arc-length parameters, walking backwards
 * when s1 < s0 so a leg travelling against the corridor's drawn direction comes
 * back in travel order.
 *
 * Both ends are the INTERPOLATED points at s0/s1, not the nearest vertices:
 * snapping to a vertex would visibly detach the route from its pin by up to
 * half a segment.
 */
export function extractSubPolyline(
  corridor: PreparedCorridor,
  s0: number,
  s1: number
): Array<[number, number]> {
  if (Math.abs(s1 - s0) < MIN_SUBPATH_LENGTH) return []
  const reversed = s1 < s0
  const lo = reversed ? s1 : s0
  const hi = reversed ? s0 : s1
  const out: Array<[number, number]> = [pointAtArcLength(corridor, lo)]
  const { cums } = corridor
  for (let i = 0; i < cums.length; i++) {
    // Strictly between, so a vertex sitting on top of an endpoint isn't emitted
    // twice.
    if (cums[i] > lo && cums[i] < hi) out.push([corridor.pts[i][0], corridor.pts[i][1]])
  }
  out.push(pointAtArcLength(corridor, hi))
  return reversed ? out.reverse() : out
}

// Interpolate the point at an arc-length parameter, clamped to the polyline's
// own extent.
function pointAtArcLength(corridor: PreparedCorridor, s: number): [number, number] {
  const { pts, cums } = corridor
  const total = cums[cums.length - 1]
  if (s <= 0) return [pts[0][0], pts[0][1]]
  if (s >= total) return [pts[pts.length - 1][0], pts[pts.length - 1][1]]
  let i = 0
  while (i < cums.length - 2 && cums[i + 1] < s) i++
  const segLen = cums[i + 1] - cums[i]
  const t = segLen > 0 ? (s - cums[i]) / segLen : 0
  return [
    pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t,
    pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t
  ]
}

export function polylineLength(pts: ReadonlyArray<readonly [number, number]>): number {
  let total = 0
  for (let i = 1; i < pts.length; i++) {
    total += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])
  }
  return total
}

/*
 * The corridor path between two adjacent stops, or null to draw a chord.
 *
 * Both endpoints have to be near the same corridor. Matching on one alone is
 * not merely weaker, it is wrong on this map: at Jatinegara the Cikarang main
 * line passes straight through the station, projecting CLOSER (0.7 units) than
 * the corridor the train actually takes (1.6), so a nearest-stroke test picks
 * the wrong one. The partner stop is what breaks the tie — it sits 704 units
 * from the through line.
 */
export function matchCorridorPath(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  corridors: readonly PreparedCorridor[],
  opts?: { maxDistWorld?: number, maxDetourRatio?: number }
): Array<[number, number]> | null {
  const maxDist = opts?.maxDistWorld ?? CORRIDOR_MATCH_MAX_DIST_WORLD
  const maxDetour = opts?.maxDetourRatio ?? CORRIDOR_MATCH_MAX_DETOUR_RATIO
  const straight = Math.hypot(bx - ax, by - ay)
  if (straight <= 0) return null

  const candidates: Array<{ corridor: PreparedCorridor, worst: number, sa: number, sb: number, index: number }> = []
  for (let i = 0; i < corridors.length; i++) {
    const corridor = corridors[i]
    const pa = projectOntoPolyline(ax, ay, corridor)
    const pb = projectOntoPolyline(bx, by, corridor)
    const worst = Math.max(pa.dist, pb.dist)
    if (worst <= maxDist) candidates.push({ corridor, worst, sa: pa.s, sb: pb.s, index: i })
  }
  // Best fit first, corridor order breaking ties. Array.prototype.sort is
  // already stable, but the explicit index tiebreak is what keeps the choice
  // deterministic where two strokes are drawn on top of each other (the LRT
  // pair, the Cikarang pair) and score within floating-point noise of one
  // another — otherwise a regenerated file could silently redraw a route.
  candidates.sort((p, q) => (p.worst - q.worst) || (p.index - q.index))

  for (const candidate of candidates) {
    const path = extractSubPolyline(candidate.corridor, candidate.sa, candidate.sb)
    if (path.length < 2) continue
    // A corridor can pass near both stops and still be the wrong one — the long
    // way round a loop, or a parallel line. Try the next best rather than
    // giving up: the right corridor is often the runner-up.
    if (polylineLength(path) > maxDetour * straight) continue
    return path
  }
  return null
}
