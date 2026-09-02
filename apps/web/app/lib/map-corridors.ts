/*
 * Corridor centerlines: the schematic's own drawn line paths, so a route leg
 * traces the corridor instead of cutting a straight chord across the artwork.
 *
 * Everything here is pure planar geometry over polylines in the map's world
 * space (the same 0 0 9513.57 6726.88 viewBox as points.json), deliberately
 * importing nothing from the app so it can be unit-tested without fare or
 * point fixtures.
 *
 * Corridors carry no line IDENTITY — the generated file has no id, and several
 * lines are drawn in one hex — so a leg is matched to a corridor GEOMETRICALLY,
 * per adjacent stop pair. That is what lets branches, the Cikarang loop and
 * interlined trunks work without any line↔stroke table.
 *
 * They do carry the artwork colour, which is a weaker thing than identity and
 * exactly the thing geometry alone cannot supply. Where two strokes are drawn on
 * the same alignment, distance picks whichever is a world unit nearer, and the
 * drawn route then runs along another line's colour — Koridor 3's yellow legs
 * traced onto a blue stub. A hex shared by five lines still tells yellow from
 * blue, so it filters candidates; it never names one.
 */

// One drawn corridor: `w` is the artwork stroke width (25 rail, 15 BRT) and `c`
// the artwork hex. Points are pre-flattened by the build script, so there are no
// curves to evaluate here.
//
// The width is a real discriminator, not just a debugging hint. Over the shipped
// sheet it is strictly binary — 74 corridors at 15, 20 at 25, nothing between —
// and it splits exactly along mode: every identified width-15 stroke carries TJ
// stops, every width-25 one carries KCI/MRTJ/LRTJ/LRTJBDB. That is the one thing
// colour cannot do here, because the palettes overlap across modes: MRT's brand
// red sits 64 channels from Koridor 1's, inside the 72 tolerance, so a rail leg
// at Dukuh Atas could elect the BRT stroke running the same alignment.
export interface Corridor {
  w: number
  c: string
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
  // The artwork hex, carried through so a match can be filtered on it. See the
  // note on Corridor: a discriminator, not an identity.
  c: string
  // The artwork stroke width, carried through for the same reason. Unlike the
  // hex this separates rail from BRT outright — see the note on Corridor.
  w: number
}

// Where a point lands on a polyline: perpendicular distance to the closest
// point, and that foot's arc-length parameter along the polyline.
export interface Projection {
  dist: number
  s: number
}

/*
 * Candidate threshold, world units — how far a stop may sit from a corridor and
 * still be considered to be served by it.
 *
 * A station's tap target usually sits ON its corridor (rail projects at ~0-2
 * units, BRT median 0.7), so most of this is slack. It exists for the case that
 * actually fails: the artwork breaks a BRT corridor at junctions, and where the
 * connecting piece is missing, a stop's own stroke ends short of it. RSPAD sits
 * 43.5 units from the corridor serving Senen Raya, so at 40 that leg had no
 * candidate reaching BOTH stops and drew a chord across the map.
 *
 * 110, measured over every adjacent TJ pair in the topology (932 of them) rather
 * than the 213 router-output pairs an earlier pass swept — that smaller sample is
 * what made 50 look like a plateau. Across the full set: 50 traces 889, 110
 * traces 916, and the worst detour ratio among accepted matches is 1.71 at BOTH
 * ends of that range, so nothing wrong is sneaking in as it rises.
 *
 * The 27 legs this recovers were then checked against the artwork itself — every
 * sampled point on all 27 lands within 11 units of drawn ink (the marker-disc
 * radius, so a path crossing a station roundel still counts as on-corridor).
 * They are real corridors the threshold was cutting off, not chords dressed up.
 *
 * Some of those legs trace SHORTER than their straight line (ratio 0.42-0.99).
 * That is expected where a pin sits off its stroke: the traced span runs foot to
 * foot along the corridor while the ratio's denominator is pin to pin.
 *
 * Why so much slack is needed at all: the artwork breaks a BRT corridor at
 * junctions, and where the connecting piece is missing a stop's own stroke ends
 * short of it. Puri Beta 2 sits 101 units from the nearest corridor at all — the
 * single worst case, and the reason the ceiling is this high; RSPAD is 43.5 from
 * the one serving Senen Raya.
 *
 * The Jatinegara trap below is unaffected: JNG's candidates are 0.7 and 1.6 units
 * away and the wrong one is rejected at 704, so this moves nothing there.
 */
export const CORRIDOR_MATCH_MAX_DIST_WORLD = 110

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
  return { pts, cums, c: corridor.c, w: corridor.w }
}

/*
 * Where the artwork's two stroke widths split, for classifying a corridor as BRT
 * or rail.
 *
 * The shipped sheet draws exactly two widths, 15 and 25, with nothing in
 * between, so any threshold in that gap classifies identically. 20 sits at the
 * midpoint, which is the most tolerant place to put it if a re-tile nudges
 * either width the way the 2026-08c palette shifted its colours.
 */
const BRT_STROKE_MAX_WIDTH = 20

/*
 * Whether a corridor is drawn as BRT rather than rail.
 *
 * Width is the only mode-reliable signal the artwork carries. Colour is not:
 * the BRT and rail palettes overlap, so a red rail line and a red BRT koridor
 * are indistinguishable to the colour gate.
 */
export function isBrtCorridor(corridor: { w: number }): boolean {
  return corridor.w <= BRT_STROKE_MAX_WIDTH
}

/*
 * Whether a corridor's drawn mode matches the mode of the line being traced.
 *
 * Kept beside isBrtCorridor rather than at either call site because the route
 * overlay and the line tracer both need exactly this test, and a rule that
 * drifts between them would let one of the two regress silently.
 */
export function modeMatches(corridor: { w: number }, legIsBrt: boolean): boolean {
  return isBrtCorridor(corridor) === legIsBrt
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
// own extent. Exported so the overlay can turn a Projection's `s` back into the
// foot's coordinates — the leg-straightening axis is built from those feet.
export function pointAtArcLength(corridor: PreparedCorridor, s: number): [number, number] {
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
export interface CorridorMatch {
  path: Array<[number, number]>
  // Index into the corridors array the path came from.
  index: number
}

/*
 * Elect the corridor a whole leg belongs to: the one serving the MOST of its
 * stops (within the distance gate), total distance breaking ties.
 *
 * This exists because pair-by-pair choice is unstable where the artwork draws
 * a corridor's two directions as parallel strokes ~22 units apart: each pair
 * picks whichever is a fraction closer and the drawn line staircases between
 * them. Rolling stickiness (keep whatever the previous pair used) fixes the
 * staircase but is DIRECTION-DEPENDENT — the same leg drawn Roxy→Kalideres
 * glued itself to the neighbouring 2A stroke because that was the only one
 * reachable from its first pair, while Kalideres→Roxy picked its own. Electing
 * from the full stop set is symmetric by construction: same stops, same answer,
 * whichever end the journey starts from.
 *
 * Returns undefined when no corridor reaches at least two stops — a preference
 * needs a pair to act on.
 */
export function pickLegCorridor(
  stops: ReadonlyArray<{ x: number, y: number }>,
  corridors: readonly PreparedCorridor[],
  opts?: { maxDistWorld?: number }
): number | undefined {
  const maxDist = opts?.maxDistWorld ?? CORRIDOR_MATCH_MAX_DIST_WORLD
  let bestIndex: number | undefined
  let bestServed = 0
  let bestTotal = Infinity
  for (let i = 0; i < corridors.length; i++) {
    let served = 0
    let total = 0
    for (const stop of stops) {
      const { dist } = projectOntoPolyline(stop.x, stop.y, corridors[i])
      if (dist <= maxDist) {
        served++
        total += dist
      }
    }
    // A single grazed stop is not a leg's corridor — a preference needs a pair.
    if (served < 2) continue
    if (served > bestServed || (served === bestServed && total < bestTotal)) {
      bestIndex = i
      bestServed = served
      bestTotal = total
    }
  }
  return bestIndex
}

export function matchCorridorPath(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  corridors: readonly PreparedCorridor[],
  opts?: {
    maxDistWorld?: number
    maxDetourRatio?: number
    preferIndex?: number
    /*
     * Which corridors this leg is allowed to ride, by index.
     *
     * Applied BEFORE the distance sort rather than to the winner afterwards.
     * The two are not the same: vetting afterwards throws the pair away when the
     * nearest stroke is the wrong one, even though the right corridor was in the
     * candidate list a place further down. Where a line and its neighbour run
     * parallel the wrong one can win by a single world unit, so that difference
     * is the whole outcome.
     */
    eligible?: (index: number) => boolean
  }
): CorridorMatch | null {
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
  if (opts?.eligible) {
    for (let i = candidates.length - 1; i >= 0; i--) {
      if (!opts.eligible(candidates[i].index)) candidates.splice(i, 1)
    }
  }
  /*
   * The leg's elected corridor first, then best fit.
   *
   * `preferIndex` comes from pickLegCorridor — the corridor the whole leg
   * belongs to — so a run of stops between two parallel strokes stays on one
   * of them instead of staircasing to whichever is a fraction closer per pair.
   *
   * It is a tiebreak, not an override: the preferred corridor still has to
   * pass the same distance and detour tests as every other candidate, so the
   * stretch it genuinely does not reach falls through to best-fit normally.
   *
   * The explicit index tiebreak below keeps the remaining order deterministic
   * where two strokes are drawn on top of each other and score within
   * floating-point noise — otherwise a regenerated file could silently redraw a
   * route.
   */
  candidates.sort((p, q) => {
    if (opts?.preferIndex !== undefined) {
      const pp = p.index === opts.preferIndex ? 0 : 1
      const qp = q.index === opts.preferIndex ? 0 : 1
      if (pp !== qp) return pp - qp
    }
    return (p.worst - q.worst) || (p.index - q.index)
  })

  for (const candidate of candidates) {
    const path = extractSubPolyline(candidate.corridor, candidate.sa, candidate.sb)
    if (path.length >= 2 && polylineLength(path) <= maxDetour * straight) {
      return { path, index: candidate.index }
    }
    /*
     * The nearest feet can be the wrong PASS of the same stroke.
     *
     * A corridor that doubles back — TJ:7F is drawn as one stroke that runs west
     * past Kwitang, loops around Monas and returns beside itself — offers two
     * feet for a stop in the overlap. projectOntoPolyline returns the nearer,
     * and at Kwitang that is the loop's return (22.4 units) rather than the
     * westward run (29.4), so the two feet of a pair land on opposite passes and
     * the sub-path between them travels 3588 units for a 703-unit hop.
     *
     * So before giving the corridor up, look for other feet: any projection onto
     * a segment that is within the distance gate, not merely the closest. The
     * detour test still decides — this only widens what it may choose from.
     */
    for (const [sa, sb] of alternativeFeet(candidate.corridor, ax, ay, bx, by, maxDist)) {
      const alt = extractSubPolyline(candidate.corridor, sa, sb)
      if (alt.length < 2) continue
      if (polylineLength(alt) > maxDetour * straight) continue
      /*
       * The alternative feet must still be the ones nearest their stops.
       *
       * A different foot can sit past a bend: TJ:14's stop at (5541, 2626) has a
       * foot on the horizontal approach and another around the corner on the
       * vertical, and taking the far one drew a straight leg that cut the fillet
       * at 81 degrees. So an alternative is only worth having when each foot is
       * no worse than the nearest by more than a stroke's width — enough to pick
       * the other PASS of a doubling-back stroke, where the two feet are within
       * a few units of each other, and not enough to skip a corner.
       */
      const daAlt = Math.hypot(alt[0][0] - ax, alt[0][1] - ay)
      const dbAlt = Math.hypot(alt[alt.length - 1][0] - bx, alt[alt.length - 1][1] - by)
      const nearestA = projectOntoPolyline(ax, ay, candidate.corridor).dist
      const nearestB = projectOntoPolyline(bx, by, candidate.corridor).dist
      if (daAlt > nearestA + ALTERNATIVE_FOOT_SLACK_WORLD) continue
      if (dbAlt > nearestB + ALTERNATIVE_FOOT_SLACK_WORLD) continue
      return { path: alt, index: candidate.index }
    }
  }
  return null
}

/*
 * Every pair of feet within the distance gate, closest-total first.
 *
 * Walks the corridor's segments rather than trusting the single nearest
 * projection, so a stroke that passes a stop twice offers both. Capped at a few
 * feet per stop: more than that is a stroke weaving past a stop repeatedly, and
 * the extra pairs cost more than they can find.
 */
function alternativeFeet(
  corridor: PreparedCorridor,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  maxDist: number
): Array<[number, number]> {
  const feetA = footCandidates(corridor, ax, ay, maxDist)
  const feetB = footCandidates(corridor, bx, by, maxDist)
  const pairs: Array<{ sa: number, sb: number, cost: number }> = []
  for (const a of feetA) {
    for (const b of feetB) {
      pairs.push({ sa: a.s, sb: b.s, cost: a.dist + b.dist })
    }
  }
  pairs.sort((p, q) => p.cost - q.cost)
  return pairs.map(pair => [pair.sa, pair.sb])
}

/*
 * Local minima of the distance from a point to the polyline, one per pass.
 *
 * A run of segments that gets closer then further again is one approach, so the
 * turning point is that pass's foot; the next approach is a separate pass.
 */
function footCandidates(
  corridor: PreparedCorridor,
  x: number,
  y: number,
  maxDist: number
): Array<{ s: number, dist: number }> {
  const { pts, cums } = corridor
  const out: Array<{ s: number, dist: number }> = []
  let best: { s: number, dist: number } | null = null
  let rising = false
  for (let i = 0; i < pts.length - 1; i++) {
    const axSeg = pts[i][0]
    const aySeg = pts[i][1]
    const dx = pts[i + 1][0] - axSeg
    const dy = pts[i + 1][1] - aySeg
    const lenSq = dx * dx + dy * dy
    const t = lenSq > 0 ? Math.max(0, Math.min(1, ((x - axSeg) * dx + (y - aySeg) * dy) / lenSq)) : 0
    const dist = Math.hypot(x - (axSeg + t * dx), y - (aySeg + t * dy))
    const s = cums[i] + t * Math.sqrt(lenSq)
    if (best === null || dist < best.dist) {
      best = { s, dist }
      rising = false
    } else if (dist > best.dist) {
      // Was approaching, now receding: the previous minimum is this pass's foot.
      if (!rising && best.dist <= maxDist) out.push(best)
      rising = true
      best = { s, dist }
    }
  }
  if (best !== null && !rising && best.dist <= maxDist) out.push(best)
  out.sort((p, q) => p.dist - q.dist)
  return out.slice(0, MAX_FEET_PER_STOP)
}

// How many passes of one stroke past a stop are worth considering.
const MAX_FEET_PER_STOP = 4

/*
 * How much further than the nearest an alternative foot may sit.
 *
 * Half a stroke width. The case this exists for — the two passes of a stroke
 * that doubles back beside itself — puts the feet within a few units of each
 * other (Kwitang sees 22.4 and 29.4 on TJ:7F's stroke), while a foot around a
 * corner is tens of units further and is what cut TJ:14's fillet.
 */
const ALTERNATIVE_FOOT_SLACK_WORLD = 12.5
