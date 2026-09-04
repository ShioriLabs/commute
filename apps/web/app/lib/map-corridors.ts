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
  /*
   * True when this is the loop-arc last resort: a path admitted only because
   * nothing within the ordinary detour ratio fitted. It is a weaker answer than
   * a normal match — a chain through the artwork's own connecting pieces, where
   * one exists, describes the route better — so callers may prefer one.
   */
  loopArc?: boolean
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

  // A loop arc that passed every test but the ratio, kept in case nothing else
  // fits at all. See the note where it is set.
  let loopArc: (CorridorMatch & { worst: number }) | null = null
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
      /*
       * A loop arc seen earlier beats this one when it sits decisively closer.
       *
       * Candidates are sorted best-fit first, so an arc rejected on ratio is
       * always the better FIT than anything accepted after it. At a loop
       * terminal that is the whole story: TJ:1's own red reaches ASEAN and
       * Masjid Agung at 49.3 units and is refused at 5.57x, while a purple
       * stroke 81.9 units away passes the ratio and wins — drawing koridor 1
       * across another line. TJ:14 is the same shape at 13.3 against 51.8.
       *
       * Requiring the arc to fit several times better keeps this to the case it
       * is for: where the arc is merely comparable, the single straight stroke
       * is still the safer answer.
       */
      if (loopArc && loopArc.worst * LOOP_ARC_FIT_ADVANTAGE < candidate.worst) {
        return { path: loopArc.path, index: loopArc.index, loopArc: true }
      }
      return { path, index: candidate.index }
    }
    /*
     * A terminal loop's closing leg is a detour by construction.
     *
     * The ratio exists to reject a corridor that reaches both stops by going the
     * long way round — but at a loop terminal, going the long way round IS the
     * route. TJ:12 runs Kota, round the Kota Tua block, and back to Mangga Dua
     * Raya: 3639 drawn units for a 278-unit hop, ratio 13.08.
     *
     * Admitted only as a LAST resort, when the loop is tried after every other
     * candidate has failed the ratio — so an ordinary pair, which always has a
     * corridor within 2.5x, never reaches this at all. Measured over every
     * adjacent TJ pair on the sheet: 584 are served within 2.5x and exactly ONE
     * is not, which is this leg. The stop must also sit ON the stroke, so a
     * corridor merely passing within the 110 gate cannot buy its way in here.
     */
    if (
      path.length >= 2
      && candidate.worst <= LOOP_ARC_MAX_FIT_WORLD
      && polylineLength(path) <= LOOP_ARC_MAX_DETOUR_RATIO * straight
    ) {
      loopArc ??= { path, index: candidate.index, worst: candidate.worst }
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
    /*
     * A loop that closes onto its OWN earlier pass.
     *
     * The sub-path extractor walks between two arc lengths on one stroke, which
     * cannot express a route that runs off the corridor's END and continues from
     * where that end rejoins the same stroke. TJ:1's Blok M terminal is exactly
     * that: ASEAN sits at s=4804 and Masjid Agung at s=4133, so walking forward
     * means going BACKWARDS 671 units round the loop the bus just came along —
     * the retrace the ratio then had to be bent to allow. The real route is 87
     * units on to the corridor's end at (3264,4817), which sits 0.2 units from
     * the stroke's own southbound pass, and onward from there.
     *
     * So when the corridor's end lands on its own body, try the path that runs
     * out to that end and resumes at the point it touches. Both halves are the
     * same stroke, so nothing here can wander onto another line.
     */
    const closed = closingPath(candidate.corridor, candidate.sa, candidate.sb)
    if (closed && polylineLength(closed) <= maxDetour * straight) {
      return { path: closed, index: candidate.index }
    }
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
  return loopArc ? { path: loopArc.path, index: loopArc.index, loopArc: true } : null
}

/*
 * How far round a loop a pair's closing leg may travel.
 *
 * TJ:12's Kota Tua circuit is 13.08x its straight line, the largest on the
 * sheet; 15 clears it without reaching the 100x+ a corridor scores when it
 * genuinely wanders the network.
 */
const LOOP_ARC_MAX_DETOUR_RATIO = 15

/*
 * ...and how well it must fit to be considered at all.
 *
 * The ratio is doing no filtering here, so the fit has to. Measured on the three
 * legs this decides, the arc sits 13.3 to 49.3 units from its stops — a loop
 * terminal draws its stops beside the circuit rather than on it, so this cannot
 * be as tight as an ordinary on-ink test. 60 covers them while staying well
 * inside the 110 gate, and the fit ADVANTAGE below is what actually keeps an
 * unrelated stroke out.
 */
const LOOP_ARC_MAX_FIT_WORLD = 60

/*
 * How much better a loop arc must fit than the straight match that beat it.
 *
 * Measured on the two legs this decides: TJ:1's arc fits at 49.3 against 81.9
 * (1.66x) and TJ:14's at 13.3 against 51.8 (3.89x). Below 1.5 the two are
 * comparable and the single stroke should win, so 1.5 admits both without
 * letting a marginal arc displace an ordinary match.
 */
const LOOP_ARC_FIT_ADVANTAGE = 1.5

/*
 * The path from `sa` out to the corridor's own end, then on to the stop from
 * where that end rejoins the stroke.
 *
 * Only for a corridor whose END lies ON its own body — a closed circuit drawn as
 * one stroke. Returns null otherwise, so an ordinary corridor is unaffected.
 */
function closingPath(
  corridor: PreparedCorridor,
  sa: number,
  sb: number
): Array<[number, number]> | null {
  const total = corridor.cums[corridor.cums.length - 1]
  /*
   * A ring is closed by whichever of the stroke's two ends touches its own body,
   * and the route leaves by whichever end lies in the direction of travel.
   *
   * Koridor 1 and 3H close at the END: the stroke runs round and its tail lands
   * back on the body, so a pair heading "backwards" leaves by the end. Koridor
   * 12 closes at the START — idx0 begins on the bottom-east run at (3855,1918),
   * goes west and up to Kota, and its head rejoins the body at s=3878, 54 units
   * short of Mangga Dua Raya. Checking only the end left that leg walking 3639
   * units the long way round instead of 293 + 54.
   */
  const viaTail = closesOnOwnBody(corridor, 'end')
  const viaHead = closesOnOwnBody(corridor, 'start')
  const options: Array<{ exit: number, rejoin: number }> = []
  if (viaTail) options.push({ exit: total, rejoin: viaTail.s })
  if (viaHead) options.push({ exit: 0, rejoin: viaHead.s })
  if (options.length === 0) return null

  let bestPath: Array<[number, number]> | null = null
  let bestLength = Math.abs(sa - sb)
  for (const { exit, rejoin } of options) {
    // Leaving by this end must be a genuine shortcut, not the long way round.
    const viaLength = Math.abs(exit - sa) + Math.abs(sb - rejoin)
    if (viaLength >= bestLength) continue
    const out = extractSubPolyline(corridor, sa, exit)
    const rest = extractSubPolyline(corridor, rejoin, sb)
    if (out.length < 2 || rest.length < 2) continue
    /*
     * Drop a duplicate vertex at the seam. The two halves meet where the ring
     * closes, so the last point of one and the first of the other are the same
     * place; emitting both leaves a zero-length edge that reads to the corner
     * checks as a 90-degree turn out of nowhere.
     */
    const last = out[out.length - 1]
    const first = rest[0]
    const joined = Math.hypot(first[0] - last[0], first[1] - last[1]) < MIN_SUBPATH_LENGTH
      ? [...out, ...rest.slice(1)]
      : [...out, ...rest]
    bestLength = viaLength
    bestPath = joined
  }
  return bestPath
}

/*
 * Where one of a corridor's ENDS meets its own BODY, closing a ring.
 *
 * Two shapes, both real on this sheet. Koridor 1's ring end lands ON its own
 * stroke (0.2 units), while koridor 3H's stops 33.7 units short at the same x —
 * a break where a station disc is drawn over the line, exactly the case
 * JOIN_COLLINEAR_EPSILON_WORLD exists for on end-to-end joins. So a wider reach
 * is granted only ALONG an axis, where the stroke plainly continues.
 *
 * Returns the arc length the end rejoins at, or null when the stroke does not
 * close on itself.
 */
function closesOnOwnBody(
  corridor: PreparedCorridor,
  which: 'start' | 'end'
): { s: number } | null {
  const { pts, cums } = corridor
  const total = cums[cums.length - 1]
  const tail = which === 'end' ? pts[pts.length - 1] : pts[0]
  let best: { s: number, dist: number, dx: number, dy: number } | null = null
  for (let i = 0; i < pts.length - 1; i++) {
    /*
     * Skip the stroke's own neighbourhood: an end always touches the segment it
     * sits on, and the one beside it, so the search has to stay well clear.
     * Measured against the far side of each segment, because a single long
     * segment would otherwise never trip a test made against its near side.
     */
    if (which === 'end' && total - cums[i + 1] < CLOSING_MIN_SEPARATION_WORLD) break
    if (which === 'start' && cums[i] < CLOSING_MIN_SEPARATION_WORLD) continue
    const ax = pts[i][0]
    const ay = pts[i][1]
    const dx = pts[i + 1][0] - ax
    const dy = pts[i + 1][1] - ay
    const lenSq = dx * dx + dy * dy
    const t = lenSq > 0 ? Math.max(0, Math.min(1, ((tail[0] - ax) * dx + (tail[1] - ay) * dy) / lenSq)) : 0
    const fx = ax + t * dx
    const fy = ay + t * dy
    const dist = Math.hypot(tail[0] - fx, tail[1] - fy)
    if (!best || dist < best.dist) {
      best = { s: cums[i] + t * Math.sqrt(lenSq), dist, dx: Math.abs(tail[0] - fx), dy: Math.abs(tail[1] - fy) }
    }
  }
  if (!best) return null
  if (best.dist <= CLOSING_JOIN_WORLD) return { s: best.s }
  // A wider break, but only where the stroke continues along one axis.
  if (best.dist > CLOSING_COLLINEAR_WORLD) return null
  if (best.dx > CLOSING_AXIS_TOLERANCE_WORLD && best.dy > CLOSING_AXIS_TOLERANCE_WORLD) return null
  return { s: best.s }
}

/*
 * How close a corridor's end must come to its own body to count as closing.
 *
 * The artwork draws a terminal loop as one continuous stroke, so the end lands
 * essentially on it — TJ:1's is 0.2 units.
 */
const CLOSING_JOIN_WORLD = 6

/*
 * ...and how far it may sit when the two are on one axis, where the break is a
 * station disc drawn over the line rather than a real end. Koridor 3H's is 33.7
 * units at identical x. Sized like JOIN_COLLINEAR_EPSILON_WORLD, which solves
 * the same problem for end-to-end joins.
 */
const CLOSING_COLLINEAR_WORLD = 90

// How far off-axis the two may sit and still read as one straight run.
const CLOSING_AXIS_TOLERANCE_WORLD = 3

/*
 * How far back along the stroke to start looking for the rejoin.
 *
 * An end trivially touches the segment it ends on, so the search skips the last
 * stretch. Long enough to clear a corner fillet, far shorter than any ring.
 */
const CLOSING_MIN_SEPARATION_WORLD = 200

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
