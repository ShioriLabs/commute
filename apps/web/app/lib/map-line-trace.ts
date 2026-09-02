/*
 * Tracing a whole LINE onto the schematic's drawn corridors.
 *
 * The route overlay traces a journey; this traces a line. Same primitives, one
 * important difference in what a wrong answer costs.
 *
 * A route overlay that picks the wrong stroke still draws its own coloured line
 * on top, so the error reads as a slightly odd path. Line isolation has no such
 * cover: the traced stroke IS the output. Electing the neighbouring corridor
 * means holding a different line at full strength while the tapped one fades —
 * a confidently wrong answer, which is worse than no answer.
 *
 * That is why an unmatched pair contributes NOTHING here rather than falling
 * back to a chord. A gap in the isolated line is honest; a chord across the map,
 * or a neighbouring line lit up, is not.
 *
 * Two gates narrow the candidates before geometry decides: artwork colour (see
 * map-corridor-colour.ts) and drawn stroke width, which is the only signal that
 * separates rail from BRT — the two palettes overlap, so a red rail line and a
 * red BRT koridor are the same colour to the first gate. The route overlay
 * applies both as well; what stays specific to isolation is refusing to chord.
 *
 * ── What the gate is worth, measured over all 10 non-BUS lines ─────────────
 *
 * Colour-blind matching lands TEN pairs on a stroke of the wrong colour —
 * LRTJBDB:CB alone puts 6 of its 11 on another line. Gated, none of them do.
 *
 * The gate also rescues rather than only rejecting: filtering candidates before
 * the election steers KCI:T and LRTJBDB:BK onto their own line instead of a
 * nearer neighbour.
 *
 * With the shared-track exception (see colourMatches) it traces 137 of 140, all
 * ten rail lines at 100%. The three it gives up belong to APCGK:KLB, which has
 * no stroke on the sheet at all. Adding the width gate changed none of this: the
 * regenerated artifact is byte-identical, because where a line's own stroke is
 * drawn the election already preferred it on distance. The gate matters in the
 * fallback, where colour has nothing left to reject and the old code would drop
 * to matching any stroke at all.
 *
 * Pure and synchronous: takes already-fetched line detail and geometry so the
 * build script and the tests drive it the same way.
 */

import { channelDistance, colourMatches, CORRIDOR_COLOUR_TOLERANCE, electArtworkColour } from './map-corridor-colour'
import {
  CORRIDOR_MATCH_MAX_DETOUR_RATIO,
  CORRIDOR_MATCH_MAX_DIST_WORLD,
  matchCorridorPath,
  modeMatches,
  pickLegCorridor,
  prepareCorridors,
  projectOntoPolyline,
  type Corridor,
  type PreparedCorridor
} from './map-corridors'

/*
 * The shape of a tap target, structurally rather than by importing Point.
 *
 * map-renderer.ts pulls in both renderers at module load, and the WebGL one
 * reads `import.meta.env` at the top level — which is fine in the app and fatal
 * in the build script that has to run this. Depending on the shape instead keeps
 * this module importable from plain node, exactly as map-corridors.ts stays
 * free of app imports so it can be tested without fixtures.
 */
export interface TracePoint {
  id: string
  station?: string
  ax: number
  ay: number
  bx: number
  by: number
}

// Mirrors pointStationId: extra shapes for one station carry synthetic ids
// (`TJ-H00037C-b`) and `station` is what names the real one.
const stationIdOf = (p: TracePoint): string => p.station ?? p.id

// Just the parts of the API's LineDetail this needs. Taking the shape rather
// than the named type keeps the build script free of an app-schema import and
// lets the tests build a line in three lines of code.
export interface TraceableSegment {
  kind: string
  stations: Array<{ id: string }>
  /*
   * The station this segment attaches to, when it is not the first of its own
   * stations. LineDetail gives a branch or loop only its OWN stops — the shared
   * junction stays on the trunk — so without this the connecting pair is never
   * offered to the matcher and the drawn line has a gap exactly where it should
   * meet its trunk.
   *
   * A station code (`JNG`), not a full id, which is why it is resolved against
   * the operator prefix below rather than looked up directly.
   */
  joinsAtCode?: string | null
}

export interface TraceableLine {
  segments: TraceableSegment[]
}

/*
 * Which other lines run a given pair of adjacent stops, as their brand colours.
 *
 * Shared track is normal here and the sheet draws it once, in one line's colour,
 * so a strict colour gate refuses the whole shared run — see colourMatches. This
 * is how the caller says "that stroke belongs to a line that really does share
 * this stretch", which is what makes the exception narrow rather than a hole.
 *
 * Called per pair rather than per line because sharing is a property of the
 * track, not of the whole route: Cikarang shares Manggarai to Sudirman with
 * Soekarno-Hatta and nothing else.
 */
export type SharedTrackLookup = (fromId: string, toId: string) => readonly string[]

// One drawn run of the line, in world units. Kept per segment rather than
// flattened so "isolate one branch" stays cheap to add later: the artifact
// already knows which edges belong to the Cikarang loop versus its trunk.
export interface TracedSegment {
  kind: string
  // Traced polyline edges as [ax, ay, bx, by]. Empty when nothing matched.
  edges: Array<[number, number, number, number]>
  // Station ids resolved to a drawn point, in line order.
  markers: string[]
  matchedPairs: number
  totalPairs: number
}

export interface TracedLine {
  segments: TracedSegment[]
  matchedPairs: number
  totalPairs: number
  /*
   * The artwork colour the line's own stops elected, which is what every gate
   * below was actually run against. Carried out so the build log can print it:
   * an election that goes wrong is otherwise invisible, and a line silently
   * re-coloured is exactly the failure this whole mechanism exists to avoid.
   *
   * Equal to the brand colour whenever the election was not decisive.
   */
  tracedColour?: string
}

/*
 * The corridor a run of stops belongs to, restricted to strokes whose artwork
 * colour is consistent with the line's own.
 *
 * pickLegCorridor sorts on distance alone, which is what lets a 2-point stub of
 * another colour win by a single world unit where strokes are stacked. Filtering
 * the candidate set BEFORE the election, rather than re-ranking after it, means
 * the wrong-coloured stroke is never in the running at all.
 *
 * Falls back to the unfiltered election when the filter leaves nothing. An
 * uncoloured corridor (every BRT one, and any rail stroke that failed to join)
 * already passes the filter, so reaching the fallback means the line's own
 * stroke is genuinely not among the candidates — and a colour-blind match is
 * still better than dropping the segment outright.
 */
function electCorridor(
  stops: ReadonlyArray<{ x: number, y: number }>,
  prepared: readonly PreparedCorridor[],
  colourAt: (index: number) => string | null,
  lineColour: string | undefined,
  modeOk: (index: number) => boolean
): number | undefined {
  const eligible: number[] = []
  for (let i = 0; i < prepared.length; i++) {
    if (modeOk(i) && colourMatches(colourAt(i), lineColour)) eligible.push(i)
  }

  if (eligible.length > 0 && eligible.length < prepared.length) {
    const subset = eligible.map(i => prepared[i])
    const picked = pickLegCorridor(stops, subset)
    if (picked !== undefined) return eligible[picked]
  }
  /*
   * The colour-blind fallback stays mode-gated. Electing across every stroke on
   * the sheet is what lets a rail line hold a BRT corridor for a whole segment,
   * and the two palettes overlap closely enough that colour alone cannot catch
   * it — see the note in map-corridors.ts.
   */
  const modeOnly: number[] = []
  for (let i = 0; i < prepared.length; i++) if (modeOk(i)) modeOnly.push(i)
  if (modeOnly.length > 0 && modeOnly.length < prepared.length) {
    const picked = pickLegCorridor(stops, modeOnly.map(i => prepared[i]))
    if (picked !== undefined) return modeOnly[picked]
  }
  return pickLegCorridor(stops, prepared)
}

/*
 * The full station id for a `joinsAtCode`.
 *
 * The code is bare (`JNG`) while points and line stations are keyed
 * `OPERATOR-CODE`. Rather than assume a prefix, borrow the operator from a
 * station this segment already names — they are all on the same line — and fall
 * back to scanning the point set, so a junction whose operator differs from its
 * segment's still resolves.
 */
function resolveJoinId(
  code: string,
  ids: readonly string[],
  byStation: ReadonlyMap<string, TracePoint>
): string | null {
  const sibling = ids[0]
  if (sibling) {
    const dash = sibling.indexOf('-')
    if (dash > 0) {
      const candidate = `${sibling.slice(0, dash)}-${code}`
      if (byStation.has(candidate)) return candidate
    }
  }
  for (const id of byStation.keys()) {
    if (id.endsWith(`-${code}`)) return id
  }
  return null
}

/*
 * A stop as the tracer uses it: its midpoint, plus the tap bar it came from.
 *
 * The midpoint stays the stop's POSITION — every match, election and detour test
 * is built on it and rail geometry is pinned to it. The bar comes along only for
 * the fit test, which asks a different question: not "where is this stop" but
 * "is it ON this stroke".
 */
interface ResolvedStop {
  id: string
  x: number
  y: number
  ax: number
  ay: number
  bx: number
  by: number
}

/*
 * How far a stop sits from a corridor, measured from its DRAWN TAP BAR rather
 * than from the single point that represents it.
 *
 * A tap target is a bar, not a dot: 12 of the 248 TJ points are over 60 world
 * units long, and the sheet draws their stroke through one END of the bar rather
 * than its middle. Cawang is the case that mattered — its bar runs x=6148.2 to
 * x=6240.4 and koridor 9's stroke passes the left end at 0.5 units, while the
 * midpoint the matcher uses is 45.6 away.
 *
 * That is not the stop being off its line; it is a bar being measured from the
 * wrong place. Asked from the midpoint, TJ:9A's chain across Cawang fits at 45.3
 * and is refused by CHAIN_MAX_FIT_WORLD_BRT (30), leaving 542 units of a line
 * undrawn along ink that runs the whole way. Asked from the bar, it fits at 0.5.
 *
 * Used ONLY where the question is whether a stop lies on a stroke. Everything
 * that decides WHERE to draw still works from the midpoint, so rail geometry —
 * whose bars are points — is untouched.
 */
function barDistance(stop: ResolvedStop, corridor: PreparedCorridor): number {
  const span = Math.hypot(stop.bx - stop.ax, stop.by - stop.ay)
  const mid = projectOntoPolyline(stop.x, stop.y, corridor).dist
  // A bar this short IS its midpoint; sampling it would cost time to learn that.
  if (span < BAR_SAMPLE_MIN_SPAN_WORLD) return mid
  let best = mid
  for (let i = 0; i <= BAR_SAMPLE_STEPS; i++) {
    const t = i / BAR_SAMPLE_STEPS
    const d = projectOntoPolyline(
      stop.ax + (stop.bx - stop.ax) * t,
      stop.ay + (stop.by - stop.ay) * t,
      corridor
    ).dist
    if (d < best) best = d
  }
  return best
}

/*
 * Below this a tap bar is effectively a point. Rail markers are drawn as dots
 * (zero span) and most BRT ones are barely wider than their disc, so this keeps
 * the sampling to the dozen bars long enough for the ends to differ from the
 * middle.
 */
const BAR_SAMPLE_MIN_SPAN_WORLD = 20

// Enough to find the near end of a 97-unit bar to within ~5 units, which is far
// finer than the thresholds this feeds.
const BAR_SAMPLE_STEPS = 20

/*
 * A segment's stations as drawn points, in line order.
 *
 * Extracted from the trace loop because the ink election needs every segment's
 * stops before any segment is traced, and resolving them twice would let the
 * election and the matcher disagree about which stops the line even has.
 *
 * A station with no drawn point is skipped rather than faulted: points.json
 * covers only what the schematic draws, and TJ topology-only stops are not on it.
 */
function resolveStops(
  segment: TraceableSegment,
  byStation: ReadonlyMap<string, TracePoint>
): ResolvedStop[] {
  const ids = segment.stations.map(station => station.id)

  /*
   * Close the segment onto the station it branches from.
   *
   * A LOOP's two ends both meet the junction, so it is prepended AND appended;
   * a CONTINUATION or RAMP only leaves from it, so it is prepended alone.
   * Without this the Cikarang loop is drawn open, missing the very stretch
   * that makes it a loop.
   *
   * The join is expressed as a bare code, so it is resolved against the ids
   * already in hand rather than assuming an operator prefix.
   */
  const joinId = segment.joinsAtCode ? resolveJoinId(segment.joinsAtCode, ids, byStation) : null
  if (joinId && ids[0] !== joinId) {
    ids.unshift(joinId)
    if (segment.kind === 'LOOP' && ids[ids.length - 1] !== joinId) ids.push(joinId)
  }

  const resolved: ResolvedStop[] = []
  for (const id of ids) {
    const point = byStation.get(id)
    if (!point) continue
    resolved.push({
      id,
      x: (point.ax + point.bx) / 2,
      y: (point.ay + point.by) / 2,
      ax: point.ax,
      ay: point.ay,
      bx: point.bx,
      by: point.by
    })
  }
  return resolved
}

/*
 * A pair traced across TWO corridors that meet end to end.
 *
 * The extractor splits a drawn line wherever the artwork breaks it, so a station
 * pair can straddle the join and no single corridor reaches both stops —
 * matchCorridorPath needs one that does, and returns nothing. Cikarang's Duri to
 * Tanah Abang is exactly this: its cyan stroke is drawn continuously but arrives
 * as corridor 5 and corridor 24, meeting exactly at (2958, 2932).
 *
 * So when the direct match fails, look for a corridor reaching the first stop
 * and another reaching the second whose endpoints coincide, and trace each half
 * to the join. Deliberately one hop, not a graph search: two strokes is what the
 * artwork's breaks actually produce, and a general path-finder over corridors
 * would be free to wander the network to connect any two points.
 *
 * Both halves face the same colour gate as a direct match, so this widens which
 * geometry can be found, never which colours are acceptable.
 */
/*
 * How far apart two corridor ends may sit and still be treated as one line.
 *
 * Most joins are exact — the extractor splits a path but both halves keep the
 * shared vertex, so nearly every same-coloured pair meets at 0.0. This is not for
 * those; it is for a break AT a station, where the marker disc is drawn over the
 * line and the stroke resumes on its far side. A disc is 44-50 units across, so
 * the surviving gap lands just under that: Sudirman Baru to Duri breaks at 47.
 *
 * 56 spans the widest disc and nothing else. It is a long way below the distance
 * two unrelated strokes of the same colour would sit apart, and both halves still
 * face the colour gate and the detour check, so widening it admits the missing
 * half of a line rather than an unrelated stub.
 */
const JOIN_EPSILON_WORLD = 56

function corridorEndpoints(corridor: PreparedCorridor): [readonly [number, number], readonly [number, number]] {
  return [corridor.pts[0], corridor.pts[corridor.pts.length - 1]]
}

/*
 * Where a corridor's END meets another corridor's BODY, rather than its end.
 *
 * A branch stub does not politely finish where the trunk finishes: it runs into
 * the SIDE of the trunk somewhere along its length. Puri Beta 2's stub is the
 * clearest case — its far end sits 0.0 units from the trunk's body, but 61.4
 * from the trunk's nearest ENDPOINT, so an end-to-end test cannot see a join
 * that the artwork draws as a solid connection.
 *
 * That mattered for three lines at once (13B, 13E and L13E all start at Puri
 * Beta 2). Left unjoined, the pair falls back to matching the trunk alone, where
 * the station projects 101 units away — inside the 110 gate, so it is accepted
 * and the branch is simply not drawn.
 *
 * Tested at the tighter END_ON_BODY epsilon rather than JOIN_EPSILON_WORLD: an
 * end landing ON a stroke is a much stronger claim than two ends being near each
 * other, so it does not need the marker-disc slack that the end-to-end case does.
 */
const JOIN_END_ON_BODY_WORLD = 6

/*
 * How close a stop has to sit to a corridor for that corridor to be a good fit
 * rather than merely an admissible one.
 *
 * Stops are drawn ON their stroke: measured across the network, rail projects at
 * ~0-2 units and BRT at a median of 0.7. Anything past a stroke's own width is
 * not "on the line" in any visual sense, so 40 is generous — it is a trigger for
 * looking harder, not a rejection, and every pair it flags still keeps its direct
 * match unless a chain genuinely fits better.
 */
const NEAR_STROKE_WORLD = 40

/*
 * How close a chain has to put BOTH stops before it displaces a direct match.
 *
 * A single drawn stroke is the safer answer, so a chain has to earn the pair.
 * The test that separates the two populations is not how much better the chain
 * is, but whether it lands the stops ON ink at all — measured over every pair
 * the guard looks at, chains split cleanly into ones that fit within 0.4-26.4
 * units and ones that barely move the stop at all (41.8-48.5, i.e. still off
 * every stroke). There is nothing in between.
 *
 * 25 sits between the two populations measured over this sheet.
 *
 * KNOWN LIMIT, measured: being a RATIO, it asks the same relative gain of a pair
 * already fitting at 59 units as of one fitting at 101, so it refuses TJ:6V's
 * seam at Mampang Prapatan — 58.9 direct against 26.4 chained is a real
 * improvement worth only 2.2x. Replacing it with an absolute chain-fit
 * threshold (30) fixes 6V and regresses KCI:A onto ~2.5k units of the Cikarang
 * line's cyan; bounding that by direct fit or by per-stop distance did not
 * separate them either. Both configurations were built and audited. Left as the
 * safer of the two until the KCI:A path is understood.
 */
const CHAIN_PREFERENCE_MARGIN_RAIL = 25

/*
 * The BRT rule: a chain wins when it lands the stops ON ink, full stop.
 *
 * The two modes fail differently, so one threshold cannot serve both. BRT
 * corridors are drawn in many short pieces broken at junctions and station
 * discs, so a stop is routinely on a DIFFERENT piece than its neighbour and
 * chaining is the normal way to trace a pair — 42 BRT pairs want it against 6
 * rail ones. Rail is drawn in long continuous strokes, so wanting a chain is
 * itself a warning sign.
 *
 * Measured over every chain the sheet offers: BRT chains that fix something land
 * at 0.4-26.4 units while the no-ops sit at 41.8-48.5, with nothing between. 30
 * is that gap. Expressed as an absolute distance rather than a ratio because the
 * question is "is the stop on its stroke", which does not scale with how bad the
 * alternative happens to be — the ratio form refused TJ:6V's seam at Mampang
 * Prapatan (58.9 direct against 26.4 chained) for being only 2.2x better.
 */
const CHAIN_MAX_FIT_WORLD_BRT = 30

/*
 * How much of a line's stop set a corridor must carry, relative to the corridor
 * the whole segment elected, before it may be matched at all.
 *
 * A ratio rather than an absolute count, because segments run from 4 stops to
 * 26. At 3, a stroke carrying a third of what the elected one carries is still
 * plausibly a piece of the same line drawn separately; below that it is a
 * neighbour. Measured over this sheet the offenders sit at 2-4 stops against an
 * elected 12-26, so they fall well outside.
 */
const MINOR_CORRIDOR_STOP_RATIO = 3

/*
 * Below this the election itself is too weak to judge anything by, so the gate
 * stands down rather than filtering on noise from a handful of stops.
 */
const MIN_ELECTED_STOPS_TO_JUDGE = 6

/*
 * Join whatever was drawn last to where this pair starts.
 *
 * A pair is drawn between the FEET its stops project to, not between the stops
 * themselves. Where consecutive pairs match different pieces of the artwork, the
 * station between them has two different feet and the space between is left
 * undrawn — 98 units on TJ:7F at Senen, 91 on MRTJ:M at Istora, 83 on TJ:9A at
 * Cawang. The line then reads as broken at a station it plainly runs through.
 *
 * Bounded by MAX_STATION_BRIDGE_WORLD: beyond that the two pairs are not
 * describing one continuous run, and a connector would be inventing track —
 * exactly what the refusal to chord exists to prevent.
 */
function bridgeFromPrevious(
  edges: Array<[number, number, number, number]>,
  path: ReadonlyArray<readonly [number, number]>
): boolean {
  const previous = edges[edges.length - 1]
  const head = path[0]
  if (!previous || !head) return true
  /*
   * Never bridge a sidestep. Doing it here rather than at each call site means
   * the chained and loop-closing paths are covered too — the LOOP segment is
   * where 7F's last two staircases came from.
   */
  if (isSidestep(previous, path)) return false
  const step = Math.hypot(head[0] - previous[2], head[1] - previous[3])
  if (step <= MIN_BRIDGE_LENGTH_WORLD || step > MAX_STATION_BRIDGE_WORLD) return true
  /*
   * A bridge may close a gap; it may not replace a corner.
   *
   * The schematic turns through a fillet, never a mitre: a run going horizontal
   * cannot change its Y, and one going vertical cannot change its X, without
   * curved section between. So a straight connector that turns hard against the
   * edge before it is cutting the corner the artwork actually draws — TJ:9A had
   * an 83-unit chord across a curve whose vertices step (6149,4915),
   * (6148,4908), (6146,4900), (6141,4894).
   *
   * Refusing leaves the two runs unjoined, which is honest: the corner is drawn,
   * this pair simply did not match it.
   */
  const bearing = (ax: number, ay: number, bx: number, by: number): number => {
    const angle = Math.atan2(by - ay, bx - ax) * 180 / Math.PI
    return ((angle % 180) + 180) % 180
  }
  const turn = (p: number, q: number): number => {
    const d = Math.abs(p - q) % 180
    return d > 90 ? 180 - d : d
  }
  const incoming = bearing(previous[0], previous[1], previous[2], previous[3])
  const across = bearing(previous[2], previous[3], head[0], head[1])
  if (turn(across, incoming) > BRIDGE_MAX_TURN_DEG) return false
  edges.push([previous[2], previous[3], head[0], head[1]])
  return true
}

// A chain's edges as a point path, for the sidestep test.
function chainHead(
  chainEdges: ReadonlyArray<readonly [number, number, number, number]>
): Array<readonly [number, number]> {
  const first = chainEdges[0]
  if (!first) return []
  return [[first[0], first[1]], [first[2], first[3]]]
}

/*
 * Whether joining these two would step sideways off the line's own stroke.
 *
 * The signature is a short connector running across both the edge before it and
 * the edge after — the sideways tread of a staircase. A genuine corner turns
 * once and keeps going; a sidestep turns, crosses, and turns back onto the same
 * bearing it left.
 */
function isSidestep(
  previous: readonly [number, number, number, number],
  path: ReadonlyArray<readonly [number, number]>
): boolean {
  if (path.length < 2) return false
  const step = Math.hypot(path[0][0] - previous[2], path[0][1] - previous[3])
  if (step < MIN_BRIDGE_LENGTH_WORLD || step > MAX_SIDESTEP_WORLD) return false
  const bearing = (ax: number, ay: number, bx: number, by: number): number => {
    const angle = Math.atan2(by - ay, bx - ax) * 180 / Math.PI
    return ((angle % 180) + 180) % 180
  }
  const between = (p: number, q: number): number => {
    const d = Math.abs(p - q) % 180
    return d > 90 ? 180 - d : d
  }
  const before = bearing(previous[0], previous[1], previous[2], previous[3])
  const across = bearing(previous[2], previous[3], path[0][0], path[0][1])
  const after = bearing(path[0][0], path[0][1], path[1][0], path[1][1])
  // Crosses both neighbours, which themselves keep the same heading.
  return between(across, before) > SIDESTEP_MIN_TURN_DEG
    && between(across, after) > SIDESTEP_MIN_TURN_DEG
    && between(before, after) < SIDESTEP_MAX_DRIFT_DEG
}

/*
 * Whether every corridor a chain rides is drawn in the line's own hex.
 *
 * Sampled from the chained edges rather than tracked through the search: the
 * chain reports geometry, not which corridors produced it, and a midpoint on a
 * stroke is an exact test when the question is only "is this the same ink".
 */
function chainCorridorInk(
  chained: { edges: Array<[number, number, number, number]> },
  prepared: readonly PreparedCorridor[],
  colourAt: (index: number) => string | null,
  tracedColour: string | undefined
): boolean {
  if (!tracedColour) return false
  for (const [ax, ay, bx, by] of chained.edges) {
    const mx = (ax + bx) / 2
    const my = (ay + by) / 2
    let nearest = Infinity
    let ink: string | null = null
    for (let i = 0; i < prepared.length; i++) {
      const dist = projectOntoPolyline(mx, my, prepared[i]).dist
      if (dist < nearest) {
        nearest = dist
        ink = colourAt(i)
      }
    }
    if (nearest > ON_INK_WORLD) continue
    if (!ink || channelDistance(ink, tracedColour) !== 0) return false
  }
  return true
}

// How close a sampled midpoint must be to count as sitting on a stroke.
const ON_INK_WORLD = 12.5

/*
 * Within this, two chains fit a pair equally well and the midpoint decides.
 *
 * A long tap bar makes every chain that touches it anywhere score near zero, so
 * the bar distance alone cannot rank them — Cawang's 92-unit bar had two chains
 * at 0.77 and 1.0, and taking the arithmetically smaller one ended TJ:9 at the
 * wrong end of the bar. A stroke's own width is the point below which "closer"
 * stops meaning anything.
 */
const FIT_TIE_WORLD = 15

/*
 * Below this a corridor is a fragment, not a route.
 *
 * Measured over the sheet, corridors reaching a single stop run 128-309 world
 * units while every corridor reaching several is 1726 or longer, so 600 sits in
 * a wide empty gap. A fragment's stop count carries no information about which
 * line it belongs to, so the ownership test stands down for it.
 */
const SHORT_CORRIDOR_WORLD = 600

// A prepared corridor's total drawn length.
function corridorLength(corridor: PreparedCorridor | undefined): number {
  if (!corridor) return 0
  return corridor.cums[corridor.cums.length - 1] ?? 0
}

/*
 * The worse of a pair's two projection distances onto one corridor.
 *
 * Deliberately from the stop's MIDPOINT, not its tap bar. This value decides
 * whether to go looking for a chain at all, so measuring it from the bar makes
 * every stop look better served than it is and suppresses the search — TJ:9 and
 * TJ:9C lost the Cawang fillet that way, stopping mid-curve at (6228, 4909).
 *
 * The bar belongs in the chain's own fit test, which asks whether a candidate
 * lands ON the stroke; this one asks how well the pair is already served.
 */
function worstEndpointDistance(
  a: { x: number, y: number },
  b: { x: number, y: number },
  corridor: PreparedCorridor
): number {
  return Math.max(
    projectOntoPolyline(a.x, a.y, corridor).dist,
    projectOntoPolyline(b.x, b.y, corridor).dist
  )
}

/*
 * How far apart two ends may sit when the stroke plainly CONTINUES across the
 * gap — same colour, same axis — rather than merely stopping nearby.
 *
 * JOIN_EPSILON_WORLD is sized for the widest station disc (56). A few breaks run
 * wider than that: TJ:6B's green is cut at Mampang Prapatan into pieces ending at
 * (4214, 4988) and (4214, 5051), the same x, 63.6 apart, and refusing that join
 * left 615 units of the line undrawn.
 *
 * Widening the general epsilon to reach it is not safe — the same-ink gaps run
 * 56.1, 58.0, 59.5, 61.4, 63.6, 67.5, 70.4, 75.2 with no break in the
 * distribution, so 64 would admit six unrelated pairs on nothing but distance.
 * What separates them is ALIGNMENT: a disc-break leaves the two ends collinear
 * (dx or dy ≈ 0), while strokes that merely finish near each other meet at an
 * angle (40/58, 43/43, 53/53). So the extra reach is granted only along an axis.
 */
const JOIN_COLLINEAR_EPSILON_WORLD = 90

// How far off-axis two ends may sit and still count as the same straight run.
const JOIN_COLLINEAR_TOLERANCE_WORLD = 3

// Below this the two halves already meet and need no connector.
const MIN_BRIDGE_LENGTH_WORLD = 0.5

/*
 * How far apart two consecutive pairs' feet may sit and still be bridged.
 *
 * Measured over the sheet, the real foot-to-foot steps at a shared station run
 * 22 to 98 units. 100 covers them without letting a bridge span the several
 * hundred units that separate genuinely different places.
 */
const MAX_STATION_BRIDGE_WORLD = 100

/*
 * Longest connector that can still be a sidestep rather than a real leg.
 *
 * Parallel strokes on this sheet sit 12-24 units apart, so a tread longer than
 * this is the line genuinely going somewhere, not hopping tracks.
 */
/*
 * How much of a line its own exact ink must cover before near-miss colours stop
 * being candidates.
 *
 * Measured over the network: the three lines that have exact ink at all cover
 * 100%, 100% and 87% of their stops with it, while every other line covers 0%.
 * Two thirds sits well inside that gap, so the rule cannot half-apply to a line
 * whose stroke is only partly drawn in its own hex.
 */
const EXACT_INK_COVERAGE = 2 / 3

/*
 * How far a corridor's hex may sit from the line's own and still BE that ink.
 *
 * Not the 72 family gate, which spans several koridors and is what the stop-count
 * test exists to disambiguate. This is the much narrower question of whether two
 * hexes are the same stroke recorded twice — the sheet's own yellow reaches TJ:3H
 * as #FAC418 against a brand of #FDCB1C, 7 channels apart and plainly one colour.
 *
 * Measured over the network the two populations do not overlap: a line's real ink
 * lands 0-24 channels from its brand (TJ:10's #89070E at 24 is the widest), while
 * the nearest DIFFERENT koridor admitted by the family gate is 56 away. 30 sits
 * in that gap.
 *
 * It matters because the stop-count gate is otherwise free to reject a stroke the
 * line is drawn on: TJ:3H's yellow reaches only 2 of its 13 stops (the rest of the
 * run is drawn as other pieces), so it was refused at 0.1 units while koridor 9's
 * navy — 222 channels away — passed on stop count and drew a 22-unit kink between
 * Damai and Jelambar.
 */
const OWN_HEX_TOLERANCE = 30

const MAX_SIDESTEP_WORLD = 60

// How sharply the tread must cut across its neighbours, and how nearly parallel
// those neighbours must stay, for the three to read as a staircase.
const SIDESTEP_MIN_TURN_DEG = 60
const SIDESTEP_MAX_DRIFT_DEG = 20

/*
 * How far a bridge may turn off the run it continues.
 *
 * Beyond this it is cutting a drawn corner rather than closing a gap along the
 * line's own heading. Generous enough for the slight kink where two pieces of
 * one stroke meet at an angle, tight enough to refuse a mitre across a fillet.
 */
const BRIDGE_MAX_TURN_DEG = 35

function joinsEndToEnd(a: PreparedCorridor, b: PreparedCorridor): [number, number] | null {
  for (const p of corridorEndpoints(a)) {
    for (const q of corridorEndpoints(b)) {
      if (Math.hypot(p[0] - q[0], p[1] - q[1]) <= JOIN_EPSILON_WORLD) return [p[0], p[1]]
    }
  }
  /*
   * A wider break that the artwork plainly draws as one continuous run: same
   * colour, and the two ends on one axis. See JOIN_COLLINEAR_EPSILON_WORLD.
   */
  if (a.c && b.c && channelDistance(a.c, b.c) === 0) {
    for (const p of corridorEndpoints(a)) {
      for (const q of corridorEndpoints(b)) {
        const dx = Math.abs(p[0] - q[0])
        const dy = Math.abs(p[1] - q[1])
        if (Math.hypot(dx, dy) > JOIN_COLLINEAR_EPSILON_WORLD) continue
        if (dx <= JOIN_COLLINEAR_TOLERANCE_WORLD || dy <= JOIN_COLLINEAR_TOLERANCE_WORLD) return [p[0], p[1]]
      }
    }
  }
  /*
   * Then the T-junction: either corridor's end lying on the other's body. The
   * join point is the end itself, so the two halves still meet exactly.
   */
  for (const p of corridorEndpoints(a)) {
    if (projectOntoPolyline(p[0], p[1], b).dist <= JOIN_END_ON_BODY_WORLD) return [p[0], p[1]]
  }
  for (const q of corridorEndpoints(b)) {
    if (projectOntoPolyline(q[0], q[1], a).dist <= JOIN_END_ON_BODY_WORLD) return [q[0], q[1]]
  }
  return null
}

/*
 * matchCorridorPath restricted to corridors this line could actually be drawn in.
 *
 * Indices are remapped rather than passing the full array with a predicate,
 * because matchCorridorPath reports the index it chose and callers need that to
 * refer to the real corridor list.
 */
function matchWithinEligible(
  a: { x: number, y: number },
  b: { x: number, y: number },
  prepared: readonly PreparedCorridor[],
  eligible: (index: number) => boolean,
  preferIndex: number | undefined
): { path: Array<[number, number]>, index: number } | null {
  const indices: number[] = []
  for (let i = 0; i < prepared.length; i++) {
    if (eligible(i)) indices.push(i)
  }
  if (indices.length === 0) return null
  const subset = indices.map(i => prepared[i])
  const prefer = preferIndex !== undefined ? indices.indexOf(preferIndex) : -1
  const match = matchCorridorPath(a.x, a.y, b.x, b.y, subset, {
    preferIndex: prefer >= 0 ? prefer : undefined
  })
  return match ? { path: match.path, index: indices[match.index] } : null
}

function matchAcrossJoin(
  a: ResolvedStop,
  b: ResolvedStop,
  prepared: readonly PreparedCorridor[],
  eligible: (index: number) => boolean
): { edges: Array<[number, number, number, number]>, fit: number } | null {
  let best: Array<[number, number, number, number]> | null = null
  let bestFit = Infinity
  let bestMidFit = Infinity
  for (let i = 0; i < prepared.length; i++) {
    if (!eligible(i)) continue
    // Only a corridor that actually reaches the first stop can start the chain.
    if (projectOntoPolyline(a.x, a.y, prepared[i]).dist > CORRIDOR_MATCH_MAX_DIST_WORLD) continue
    for (let j = 0; j < prepared.length; j++) {
      if (i === j || !eligible(j)) continue
      if (projectOntoPolyline(b.x, b.y, prepared[j]).dist > CORRIDOR_MATCH_MAX_DIST_WORLD) continue
      const join = joinsEndToEnd(prepared[i], prepared[j])
      if (!join) continue
      const first = matchCorridorPath(a.x, a.y, join[0], join[1], [prepared[i]])
      const second = matchCorridorPath(join[0], join[1], b.x, b.y, [prepared[j]])
      if (!first || !second) continue
      const edges: Array<[number, number, number, number]> = []
      for (const path of [first.path, second.path]) {
        /*
         * Bridge the two halves.
         *
         * Each half is extracted from its OWN corridor, so the first ends where
         * that stroke ends and the second begins where the next one begins —
         * which are only the same point when the artwork shares a vertex. Where
         * the join is approximate (a break at a station disc, or one stroke
         * meeting another's side) the two feet sit tens of units apart and
         * concatenating the paths leaves that space undrawn. It is the same
         * seam three koridors showed at Cawang, 41.5 units wide on a stroke that
         * runs continuously underneath.
         */
        const tail = edges[edges.length - 1]
        if (tail && path.length > 0) {
          const [hx, hy] = path[0]
          // Only when the two halves genuinely do not meet. Where the artwork
          // shares a vertex they already do, and a zero-length edge there is
          // noise in the artifact rather than a connector.
          if (Math.hypot(hx - tail[2], hy - tail[3]) > MIN_BRIDGE_LENGTH_WORLD) {
            edges.push([tail[2], tail[3], hx, hy])
          }
        }
        for (let k = 0; k < path.length - 1; k++) {
          edges.push([path[k][0], path[k][1], path[k + 1][0], path[k + 1][1]])
        }
      }
      if (edges.length === 0) continue
      /*
       * Keep the chain whose halves sit CLOSEST to the two stops, rather than
       * the first one index order happens to produce.
       *
       * Several chains usually qualify, because the trunk is drawn in pieces
       * that all join each other: at Puri Beta 2, corridors 63, 64 and 66 chain
       * among themselves while only 65 is the station's own branch stub. Taking
       * the first found returned a trunk-to-trunk chain that begins 101 units
       * from the stop, and the branch — the whole reason to chain here — was
       * never drawn.
       */
      /*
       * The detour test, applied to the JOINED path.
       *
       * matchCorridorPath already vetted each half, but only against its own
       * short leg — a chain can therefore pass twice and still be absurd end to
       * end. KCI:C's Dukuh Atas to Tanah Abang chains into 9651 world units for
       * a 729-unit hop: each half looks locally reasonable while the pair rides
       * most of the way round the network. Measured over every chain the sheet
       * offers, the legitimate ones run 1.00-1.30x and the only offender is
       * 13.24x, so the existing 2.5x ceiling separates them with room to spare.
       */
      const straight = Math.hypot(b.x - a.x, b.y - a.y)
      if (straight > 0) {
        let chained = 0
        for (const [ex, ey, fx, fy] of edges) chained += Math.hypot(fx - ex, fy - ey)
        if (chained > CORRIDOR_MATCH_MAX_DETOUR_RATIO * straight) continue
      }
      /*
       * How well this chain serves the pair.
       *
       * Measured from each stop's drawn tap bar, because a bar is where the stop
       * IS: 12 of the 248 TJ points are over 60 world units long and the sheet
       * runs their stroke through one END rather than the middle. Cawang's bar
       * spans x=6148.2 to x=6240.4 and koridor 9's stroke passes the left end at
       * 0.5 units while the midpoint sits 45.6 away, so a midpoint ruler refused
       * TJ:9A's chain at CHAIN_MAX_FIT_WORLD_BRT and left 542 units undrawn.
       *
       * Tie-broken by the MIDPOINT distance, which is what keeps the bar from
       * choosing between chains. Several chains reach one long bar equally well
       * — every one that touches it anywhere scores near zero — and picking
       * among them by bar alone let TJ:9 stop at the far end of Cawang's bar
       * instead of carrying on round the fillet, losing 655 units of correct
       * geometry. The bar says whether a chain reaches the stop; the midpoint
       * still says which of them reaches it best.
       */
      const fit = Math.max(barDistance(a, prepared[i]), barDistance(b, prepared[j]))
      const midFit = Math.max(
        projectOntoPolyline(a.x, a.y, prepared[i]).dist,
        projectOntoPolyline(b.x, b.y, prepared[j]).dist
      )
      /*
       * A chain is only credible when it lands BOTH stops on ink.
       *
       * Two corridors that merely pass within the distance gate can be glued
       * into a plausible-looking path across a stretch the schematic does not
       * draw at all: KCI:A's Sudimara and Batu Ceper sit 236 and 376 units from
       * every rail stroke, and a chain still reaches both ends of that gap at 16
       * units by joining two unrelated pieces. Requiring the stops to be ON the
       * halves keeps chaining to what it is for — a line drawn in pieces — and
       * out of gaps where the line is not drawn.
       */
      if (fit < bestFit - FIT_TIE_WORLD || (fit < bestFit + FIT_TIE_WORLD && midFit < bestMidFit)) {
        bestFit = Math.min(fit, bestFit)
        bestMidFit = midFit
        best = edges
      }
    }
  }
  return best ? { edges: best, fit: bestFit } : null
}

export function traceLine(
  line: TraceableLine,
  points: readonly TracePoint[],
  corridors: readonly Corridor[],
  /*
   * Artwork colour per corridor, aligned by index. Optional: corridors carry
   * their own colour now, so this only exists for tests that want to drive the
   * gate directly. A null entry is "unknown", never "excluded".
   */
  corridorColour: ReadonlyArray<string | null> | undefined,
  // The line's brand colour. Undefined disables the colour gate entirely, which
  // is the pre-existing colour-blind behaviour.
  lineColour: string | undefined,
  // Optional; without it the colour gate stays strict, which is the behaviour
  // every test that does not pass one is pinning.
  sharedTrack?: SharedTrackLookup,
  /*
   * Whether this line is drawn as BRT rather than rail, which restricts it to
   * the artwork's matching stroke width.
   *
   * Optional, and omitting it disables the mode gate entirely rather than
   * assuming rail — the tests build corridors at a single width and would all
   * start failing the gate on a default. Callers with an operator to hand should
   * always pass it: it is the only signal that separates a red rail line from a
   * red BRT koridor drawn on the same alignment.
   */
  isBrt?: boolean
): TracedLine {
  // First alias wins, but an exact id always beats an alias — the same rule the
  // route overlay uses, so a station drawn twice pins the same shape in both.
  const byStation = new Map<string, TracePoint>()
  for (const p of points) {
    const stationId = stationIdOf(p)
    if (p.id === stationId || !byStation.has(stationId)) byStation.set(stationId, p)
  }

  /*
   * Every shape drawn for a station, not just the one that won above.
   *
   * Where two koridors meet at an interchange the sheet draws the station TWICE,
   * once on each line's own stroke, so that each can call at a dot it actually
   * runs through. Flyover Jatinegara is the case the label spells out —
   * "11-13 10-15 Flyover Jatinegara" against two dots: TJ-H00037C at (6390,4200)
   * sits 0.7 units from koridor 11's #181284, and TJ-H00037C-b at (6216,4309)
   * sits 0.5 from koridor 10's own #89070E.
   *
   * "Exact id beats alias" then picks koridor 11's dot for BOTH lines, leaving
   * koridor 10 calling at a stop 123.5 units off its own stroke — outside the
   * 110 gate, so the pair matched nothing and 396 units went undrawn. The right
   * dot is not the one whose id has no suffix; it is the one on the line's own
   * ink, which is what chooseDrawnPoint picks below.
   */
  const shapesByStation = new Map<string, TracePoint[]>()
  for (const p of points) {
    const stationId = stationIdOf(p)
    const list = shapesByStation.get(stationId)
    if (list) list.push(p)
    else shapesByStation.set(stationId, [p])
  }

  const prepared = corridors.length > 0 ? prepareCorridors(corridors) : []
  // Prefer the colour the corridor carries; the override is for tests.
  const colourAt = (index: number): string | null =>
    corridorColour?.[index] ?? corridors[index]?.c ?? null
  // Undefined isBrt leaves every corridor mode-eligible, per the parameter note.
  const modeOk = (index: number): boolean => {
    if (isBrt === undefined) return true
    const corridor = prepared[index]
    return corridor ? modeMatches(corridor, isBrt) : false
  }
  const segments: TracedSegment[] = []
  let matchedPairs = 0
  let totalPairs = 0

  /*
   * Resolve every segment's stops up front, because the ink election needs the
   * WHOLE line's stops before any segment is traced. Resolving inside the loop
   * as well would do the same work twice and risk the two copies drifting.
   */
  const resolvedBySegment = line.segments.map(segment => resolveStops(segment, byStation))

  /*
   * Which artwork colour this line is actually drawn in, decided by its own
   * stops rather than taken from the brand palette. See electArtworkColour: for
   * three BRT lines the brand hex is 88-102 channels from their real ink, and in
   * two of those the wrong stroke passes the gate while the right one does not.
   *
   * Mode-eligible corridors only. A rail line electing a BRT stroke's colour
   * would defeat the one gate that never relaxes, so the width filter runs
   * first here exactly as it does in every predicate below.
   */
  const modeEligible: Array<{ c: string, project: (x: number, y: number) => number }> = []
  for (let i = 0; i < prepared.length; i++) {
    if (!modeOk(i)) continue
    const corridor = prepared[i]
    modeEligible.push({
      c: colourAt(i) ?? '',
      project: (x, y) => projectOntoPolyline(x, y, corridor).dist
    })
  }
  const allStops = resolvedBySegment.flat()

  const tracedColour = electArtworkColour(allStops, modeEligible, lineColour)

  /*
   * Second pass: re-resolve the stations the sheet draws more than once, now
   * that the line's own ink is known.
   *
   * Two passes rather than one because the two questions depend on each other —
   * the ink is elected from the stops, and which dot is the right stop depends
   * on the ink. The election is safe to run on the first pass's choice: only two
   * stations on the whole sheet are drawn twice, so the ballot moves by at most
   * two votes out of a line's whole stop list, far below CORRIDOR_INK_MIN_LEAD.
   */
  const ambiguous = new Set<string>()
  for (const stop of allStops) {
    if ((shapesByStation.get(stop.id)?.length ?? 0) > 1) ambiguous.add(stop.id)
  }
  if (ambiguous.size > 0 && tracedColour) {
    /*
     * Of the shapes drawn for this station, the one sitting on the line's OWN
     * ink. Falls back to the first-alias choice when none of them does, so a
     * station whose duplicate belongs to neither line behaves as it always has.
     */
    const chooseDrawnPoint = (stationId: string): TracePoint | undefined => {
      const shapes = shapesByStation.get(stationId)
      if (!shapes || shapes.length < 2) return byStation.get(stationId)
      /*
       * The dot nearest a stroke this line could be drawn in, by the SAME colour
       * gate the matcher uses.
       *
       * Not an exact hex: only three lines' brands match their artwork to the
       * channel, and for everything else the elected colour IS the brand, which
       * no corridor matches exactly — TJ:10's #9b1f21 sits 24 from the #89070E
       * it is drawn in, so exactness left no candidate and kept the wrong dot.
       *
       * The gate stays a FAMILY test, which is safe here only because the
       * winner must also be ON its stroke (see below). Letting it pick the
       * merely-nearest tolerated stroke instead cost TJ:10D 782 units drawn on
       * koridor 7F's #F71752 while its pair count rose 14->16 — the exact trade
       * the ink audit exists to catch.
       */
      const first = byStation.get(stationId)
      let best: TracePoint | undefined
      let bestDist = Infinity
      for (const shape of shapes) {
        const x = (shape.ax + shape.bx) / 2
        const y = (shape.ay + shape.by) / 2
        let onInk = Infinity
        for (let i = 0; i < prepared.length; i++) {
          if (!modeOk(i)) continue
          const ink = colourAt(i)
          if (!ink || !colourMatches(ink, tracedColour)) continue
          onInk = Math.min(onInk, projectOntoPolyline(x, y, prepared[i]).dist)
        }
        if (onInk < bestDist) {
          bestDist = onInk
          best = shape
        }
      }
      /*
       * Only move off the first-alias choice when the winner is decisively
       * better. Where both dots sit on tolerated ink the pick is a coin toss the
       * colour gate cannot settle, and changing it for a fraction of a unit
       * would make the trace depend on point order rather than on the artwork.
       */
      if (first && best && best !== first) {
        const fx = (first.ax + first.bx) / 2
        const fy = (first.ay + first.by) / 2
        let firstOnInk = Infinity
        for (let i = 0; i < prepared.length; i++) {
          if (!modeOk(i)) continue
          const ink = colourAt(i)
          if (!ink || !colourMatches(ink, tracedColour)) continue
          firstOnInk = Math.min(firstOnInk, projectOntoPolyline(fx, fy, prepared[i]).dist)
        }
        if (firstOnInk <= ON_INK_WORLD) return first
      }
      /*
       * Only when the winner is plainly ON its stroke. Where neither dot is, the
       * station is not drawn for this line at all and the first-alias choice is
       * as good an answer as any — reaching for the nearer of two distant dots
       * would be guessing.
       */
      return bestDist <= ON_INK_WORLD ? best : byStation.get(stationId)
    }
    const chosen = new Map<string, TracePoint>()
    for (const stationId of ambiguous) {
      const point = chooseDrawnPoint(stationId)
      if (point) chosen.set(stationId, point)
    }
    for (const resolved of resolvedBySegment) {
      for (const stop of resolved) {
        const point = chosen.get(stop.id)
        if (!point) continue
        stop.x = (point.ax + point.bx) / 2
        stop.y = (point.ay + point.by) / 2
        stop.ax = point.ax
        stop.ay = point.ay
        stop.bx = point.bx
        stop.by = point.by
      }
    }
  }

  /*
   * Whether a corridor is drawn in this line's OWN ink, as opposed to merely a
   * colour the family gate tolerates. See OWN_HEX_TOLERANCE.
   */
  const isOwnHex = (ink: string | null): boolean =>
    !!ink && !!tracedColour && channelDistance(ink, tracedColour) <= OWN_HEX_TOLERANCE

  /*
   * How many of the LINE's stops each corridor reaches, cached once.
   *
   * Counted over the whole line rather than the segment being traced: a corridor
   * either carries this line or it does not, and a five-stop loop cannot answer
   * that on its own. 7F's Monas loop is the case — koridor 5's stroke happens to
   * pass all five of the loop's stops, so per-segment counting saw nothing wrong,
   * while over the full line it carries 2 of 23 against 7F's own 13.
   */
  const lineServesCache = new Map<number, number>()
  const lineServes = (index: number): number => {
    const hit = lineServesCache.get(index)
    if (hit !== undefined) return hit
    const corridor = prepared[index]
    let count = 0
    if (corridor) {
      for (const stop of allStops) {
        if (projectOntoPolyline(stop.x, stop.y, corridor).dist <= NEAR_STROKE_WORLD) count++
      }
    }
    lineServesCache.set(index, count)
    return count
  }
  // The best any corridor manages, which is what a candidate is measured against.
  let bestLineServes = 0
  for (let i = 0; i < prepared.length; i++) {
    if (modeOk(i) && colourMatches(colourAt(i), tracedColour)) {
      bestLineServes = Math.max(bestLineServes, lineServes(i))
    }
  }

  /*
   * Whether the line's EXACT ink already covers most of it.
   *
   * The colour gate is a tolerance, so it admits a family: 7F's pink sits 65
   * channels from koridor 5's #CD4411, inside the 72 gate, and koridor 5's
   * stroke runs the Monas block that 7F loops through. Distance then hands 7F
   * that stroke and it is drawn along koridor 5 for a quarter of its length.
   *
   * But where a line's own hex is drawn on the sheet, it is drawn for the WHOLE
   * line — 7F's #F71752 appears as four separate corridors covering 20 of its 23
   * stops. There is no reason to reach for a near-miss colour at all, so those
   * are dropped from the candidate set.
   *
   * Only lines whose brand matches the artwork exactly qualify: measured, that
   * is TJ:7, TJ:7F and TJ:14 and no others, because every other line's brand
   * differs slightly from its drawn hex and has no exact corridor to prefer.
   * For them nothing changes.
   */
  const exactInkStops = new Set<number>()
  for (let i = 0; i < prepared.length; i++) {
    if (!modeOk(i)) continue
    const ink = colourAt(i)
    if (!ink || !tracedColour || channelDistance(ink, tracedColour) !== 0) continue
    allStops.forEach((stop, index) => {
      if (projectOntoPolyline(stop.x, stop.y, prepared[i]).dist <= NEAR_STROKE_WORLD) {
        exactInkStops.add(index)
      }
    })
  }
  const hasOwnInk = allStops.length > 0
    && exactInkStops.size >= allStops.length * EXACT_INK_COVERAGE

  for (let segmentIndex = 0; segmentIndex < line.segments.length; segmentIndex++) {
    const segment = line.segments[segmentIndex]
    const resolved = resolvedBySegment[segmentIndex]

    const edges: Array<[number, number, number, number]> = []
    let segMatched = 0
    // The corridor the previous pair rode, so a run stays on one stroke.
    let lastCorridor: number | undefined
    const segTotal = Math.max(0, resolved.length - 1)

    if (resolved.length >= 2 && prepared.length > 0) {
      /*
       * Elected once per SEGMENT, not per line. A branch leaves its trunk onto a
       * different stroke, so one election across the whole line would hold the
       * trunk's corridor through the branch and match nothing there. The Cikarang
       * loop is the same story from the other direction.
       */
      /*
       * The election stays strict on colour: it picks the stroke for the whole
       * segment, and admitting a neighbour's colour there would let a shared
       * stretch drag the entire run onto the wrong line. The per-pair check
       * below is where sharing is allowed, because that is the scope sharing
       * actually has.
       */
      const preferIndex = electCorridor(resolved, prepared, colourAt, tracedColour, modeOk)
      /*
       * How many of this segment's stops each corridor reaches, and how many the
       * elected one reaches. Cached per segment rather than recomputed per pair:
       * the predicates below run for every corridor on every pair.
       */
      const servesCache = new Map<number, number>()
      const servesCount = (index: number): number => {
        const hit = servesCache.get(index)
        if (hit !== undefined) return hit
        const corridor = prepared[index]
        let count = 0
        if (corridor) {
          for (const stop of resolved) {
            if (projectOntoPolyline(stop.x, stop.y, corridor).dist <= CORRIDOR_MATCH_MAX_DIST_WORLD) count++
          }
        }
        servesCache.set(index, count)
        return count
      }
      const electedServes = preferIndex !== undefined ? servesCount(preferIndex) : 0
      for (let i = 0; i < resolved.length - 1; i++) {
        const a = resolved[i]
        const b = resolved[i + 1]
        const shared = sharedTrack ? sharedTrack(a.id, b.id) : undefined
        // Mode first in both predicates: a stroke of the wrong width is never
        // this line's, whatever its colour or who shares its track.
        const eligible = (index: number) => modeOk(index)
          && carriesLine(index, shared)
          && colourMatches(colourAt(index), tracedColour, shared)
        /*
         * Match against the eligible corridors only, rather than matching first
         * and vetting the winner.
         *
         * matchCorridorPath ranks on distance and returns one answer, so where
         * this line and another are drawn as parallel strokes the neighbour can
         * win by a single world unit — Tanah Abang to Karet picks a navy stroke
         * 40 units away over its own cyan at 41. Vetting afterwards then throws
         * the pair away even though the right corridor was sitting in the
         * candidate list. Filtering first puts the question the right way round:
         * of the strokes that COULD be this line, which fits best.
         */
        /*
         * Own colour first, shared-track colours only as a fallback.
         *
         * Sharing STOPS is not sharing TRACK. Soekarno-Hatta and Cikarang both
         * call at Manggarai and Sudirman but are drawn as separate parallel
         * strokes between them, so admitting the neighbour's colour up front
         * traced Soekarno-Hatta down the cyan line. Trying strict first means
         * the exception only applies where this line genuinely has no stroke of
         * its own — which is what shared track actually looks like.
         */
        /*
         * A corridor that carries almost none of this line's stops is not this
         * line's corridor, however close it happens to sit.
         *
         * The colour gate is a FAMILY test, so a neighbouring koridor drawn in a
         * near-enough hue passes it — koridor 9's teal is 56 channels from 6V's
         * green, inside the 72 tolerance. Where that neighbour's stroke runs
         * closer to a pair than the line's own, it wins on distance and the drawn
         * line jumps onto it for one pair, leaving a visible break either side.
         *
         * Restricted to BRT: the rail palette does not overlap this way, and
         * rail corridors are drawn as long single strokes where a low stop count
         * means the piece genuinely is not the line's.
         */
        const carriesLine = (index: number, sharedColours?: readonly string[]): boolean => {
          if (isBrt !== true || preferIndex === undefined) return true
          /*
           * A line drawn in its own hex has no business on a near-miss one.
           * See hasOwnInk: this is what keeps 7F off koridor 5's stroke.
           *
           * Shared track is the exception, and only where the caller can name it:
           * `sharedColours` holds the brand colours of lines serving BOTH stops
           * of this pair, so a stroke drawn in one of those is this line's track
           * painted as its neighbour. 7F runs Kwitang to Senen with koridor 2 and
           * 2A on one navy stroke, and there is no pink there to prefer.
           */
          if (hasOwnInk) {
            const ink = colourAt(index)
            if (!ink || !tracedColour) return false
            if (isOwnHex(ink)) return true
            if (sharedColours) {
              for (const other of sharedColours) {
                if (channelDistance(ink, other) <= CORRIDOR_COLOUR_TOLERANCE) return true
              }
            }
            return false
          }
          /*
           * Judge against the whole line, not this segment. A stroke carrying a
           * couple of the line's stops is a neighbour it happens to run beside,
           * however many stops of one short loop it passes.
           */
          /*
           * A SHORT corridor is exempt: it cannot reach many stops whoever it
           * belongs to, so its stop count says nothing about ownership. The
           * artwork breaks a stroke into many such pieces — Puri Beta 2's branch
           * stub is 137 units and reaches exactly one stop, and refusing it left
           * three lines starting 101 units from the station they terminate at.
           * Measured on this sheet, corridors serving one stop run 128-309 units
           * while every multi-stop one is 1726 or longer.
           */
          if (corridorLength(prepared[index]) > SHORT_CORRIDOR_WORLD
            && bestLineServes >= MIN_ELECTED_STOPS_TO_JUDGE
            && lineServes(index) * MINOR_CORRIDOR_STOP_RATIO < bestLineServes
            // Except a piece drawn in the line's OWN hex: the artwork breaks a
            // stroke into many pieces and most carry only a stop or two, so a
            // stop count cannot judge them. Compared against the ink the line is
            // drawn in, not the segment's election — a short loop elects
            // whatever passes it.
            && !isOwnHex(colourAt(index))) {
            return false
          }
          if (electedServes < MIN_ELECTED_STOPS_TO_JUDGE) return true
          /*
           * A piece drawn in the elected corridor's OWN FAMILY is this line's
           * stroke, however short — the artwork breaks a corridor into many
           * pieces and most carry only a stop or two.
           *
           * Compared for an EXACT hex match, not within the colour tolerance.
           *
           * The tolerance is a family test, and a family here spans several
           * koridors: TJ:7F's crimson sits 65 channels from koridor 5's #CD4411,
           * inside the 72 gate. Exempting on tolerance therefore handed 7F a
           * stroke carrying 15 of koridor 5's stops and 1 of its own, and it drew
           * along koridor 5 through Kwitang. An exact match is the only version
           * of "this is the same stroke, drawn in pieces" that the sheet supports
           * — measured, every legitimate fragment matches its elected corridor's
           * hex exactly, and every offender differs by 40 or more.
           */
          const electedInk = colourAt(preferIndex)
          const ink = colourAt(index)
          if (electedInk && ink && channelDistance(ink, electedInk) === 0) return true
          /*
           * ...and a piece drawn in the LINE's own ink, on the same reasoning
           * from the other direction.
           *
           * The test above asks whether this stroke matches the one the segment
           * elected, which fails whenever the election itself landed on a
           * neighbour. TJ:3H is that case: its yellow is drawn in pieces, none
           * reaching more than 2 of the segment's stops, so the election went to
           * koridor 9's navy and every yellow fragment then read as a minority
           * stroke — including the one passing 0.1 units from both Damai and
           * Jelambar, which was refused while the navy 22 units away was kept.
           *
           * Judged at OWN_HEX_TOLERANCE rather than the family gate, so this
           * stays "the same colour recorded twice" and cannot re-admit the
           * neighbouring koridor the stop count is there to reject.
           */
          if (isOwnHex(ink)) return true
          return servesCount(index) * MINOR_CORRIDOR_STOP_RATIO >= electedServes
        }
        // Whether this corridor is drawn in the colour of a line that serves both
        const strict = (index: number) => modeOk(index) && carriesLine(index) && colourMatches(colourAt(index), tracedColour)
        /*
         * This line's OWN colour first, in both shapes — a single stroke, then a
         * chain of two — before any of the shared-track fallback.
         *
         * Sharing stops is not sharing track, and the fallback cannot tell the
         * difference: TJ:4 also calls at Halimun and Galunggung, so its purple is
         * offered as shared track, and the purple stroke between them is nearer
         * than TJ:6's own green. The green is there, just drawn in two pieces —
         * corridor 50 reaches Halimun, 53 reaches Galunggung and they meet.
         * Trying the chain only after the fallback meant TJ:6 was drawn along
         * koridor 4's line for that whole stretch.
         */
        /*
         * Prefer the corridor the previous pair actually used.
         *
         * Where a line and a neighbour are drawn as parallel strokes 12-24 units
         * apart, consecutive pairs pick whichever is a fraction nearer and the
         * drawn line steps sideways between them — a staircase the schematic
         * never draws, because a stroke does not jump to a parallel one
         * mid-block. 7F showed three, at Senen, Balai Kota and Monas.
         *
         * Narrower than `preferIndex`, which is elected once for the whole
         * segment: this is the LAST corridor, so it also holds a run together
         * through a stretch the election did not win. It stays a preference —
         * matchCorridorPath applies the same distance and detour tests to it as
         * to any other candidate, so a pair the previous corridor genuinely does
         * not reach still falls through to best fit.
         */
        /*
         * Stickiness must not outrank the line's own ink.
         *
         * `lastCorridor` holds a run on one stroke, which is what stops the
         * staircase — but if the previous pair had to borrow a shared stroke, it
         * would then drag the rest of the run onto it. 7F's Monas loop did this:
         * the first pair is detour-rejected on the pink, takes koridor 2's navy,
         * and stickiness carried the navy round a loop where three of the four
         * pairs can ride the pink.
         *
         * So the preference is dropped when it points at a stroke that is not
         * this line's own colour; the segment's election takes over, and the
         * distance test decides as usual.
         */
        const stickyInk = lastCorridor !== undefined ? colourAt(lastCorridor) : null
        const stickyIsOwn = !!stickyInk && !!tracedColour && channelDistance(stickyInk, tracedColour) === 0
        const sticky = stickyIsOwn ? lastCorridor : preferIndex
        const own = matchWithinEligible(a, b, prepared, strict, sticky)
        const ownChain = own ? null : matchAcrossJoin(a, b, prepared, strict)
        if (!own && ownChain) {
          if (ownChain.edges.length > 0) {
            if (!bridgeFromPrevious(edges, chainHead(ownChain.edges))) continue
          }
          edges.push(...ownChain.edges)
          segMatched++
          continue
        }
        const match = own ?? matchWithinEligible(a, b, prepared, eligible, sticky)
        /*
         * A match that leaves a stop far off its stroke is worse than a chain.
         *
         * CORRIDOR_MATCH_MAX_DIST_WORLD is deliberately loose (110) so a stop
         * stranded by a break in the artwork still finds its corridor. That slack
         * has a cost where a line BRANCHES: the trunk it is leaving usually still
         * passes within the gate, so the trunk match succeeds and the branch is
         * never drawn. Puri Beta 2 is the case — it sits 101 units from the trunk
         * that matched and 1.8 from its own stub, so 13B, 13E and L13E all ran
         * straight past the station they start at.
         *
         * So when the winner fits one end this poorly, look for a chain and
         * prefer it when it genuinely sits closer. The direct match still stands
         * whenever no better-fitting chain exists, which is every ordinary pair.
         */
        const directFit = match ? worstEndpointDistance(a, b, prepared[match.index]) : Infinity
        /*
         * A chain never displaces a match already on the line's own ink.
         *
         * The preference below exists for a stop stranded by a break in the
         * artwork, where any chain that reaches it beats a distant single
         * stroke. It must not fire when the direct match is already the line's
         * own colour: 7F's Monas arm fits its pink at 48 units, and a navy chain
         * fits at 24.8, so the fit test alone handed two pairs of the loop to
         * koridor 2's stroke even though the pink was right there.
         */
        const matchIsOwnInk = match !== null
          && !!tracedColour
          && channelDistance(colourAt(match.index) ?? '', tracedColour) === 0
        if (directFit > NEAR_STROKE_WORLD) {
          const chained = matchAcrossJoin(a, b, prepared, strict)
            ?? matchAcrossJoin(a, b, prepared, eligible)
          /*
           * Only when the chain is a decisive improvement, not merely different.
           *
           * The direct match is the safer answer by default: it is one drawn
           * stroke rather than two glued together. A chain earns the pair only by
           * sitting an order of magnitude closer to the stops — at Puri Beta 2 it
           * is 1.8 units against the trunk's 101. Requiring a wide margin is what
           * keeps this off the rail network, where a stop stranded by a genuine
           * artwork break (KCI:A's Sudimara and Batu Ceper) has a nearer chain
           * available that nonetheless glues the wrong two strokes together.
           */
          /*
           * ...but only if the chain is not moving the line off its own colour.
           * Where the direct match already rides the line's ink, a better-fitting
           * chain in someone else's is the wrong trade — see the note above.
           * A chain on the SAME ink still wins, which is what recovers the branch
           * stub at Puri Beta 2.
           */
          /*
           * Only lines that HAVE their own exact ink can insist a chain use it.
           * Every other line is drawn in a hex its brand does not match exactly
           * (13B/13E/L13E are branded #7A357B and drawn #5F136C), so demanding
           * exactness there would refuse them their own branch stubs.
           */
          const chainIsOwnInk = chained !== null
            && (!hasOwnInk || chainCorridorInk(chained, prepared, colourAt, tracedColour))
          if (
            chained
            && (!matchIsOwnInk || chainIsOwnInk)
            && (isBrt === true
              ? chained.fit <= CHAIN_MAX_FIT_WORLD_BRT && chained.fit < directFit
              : chained.fit * CHAIN_PREFERENCE_MARGIN_RAIL < directFit)
          ) {
            if (chained.edges.length > 0) {
              if (!bridgeFromPrevious(edges, chainHead(chained.edges))) continue
            }
            edges.push(...chained.edges)
            segMatched++
            continue
          }
        }
        if (!match) {
          // Nothing reaches both stops. Before giving up, try the one shape the
          // artwork's own breaks produce: two corridors meeting end to end.
          // Strict first here too, for the reason given above: the chain should
          // not reach for a neighbour's colour while this line's own stroke is
          // available on both halves.
          const chained = matchAcrossJoin(a, b, prepared, strict)
            ?? matchAcrossJoin(a, b, prepared, eligible)
          if (chained) {
            if (chained.edges.length > 0) {
              if (!bridgeFromPrevious(edges, chainHead(chained.edges))) continue
            }
            edges.push(...chained.edges)
            segMatched++
          }
          // Otherwise leave a gap. No chord fallback: a straight line across the
          // artwork would claim the line runs somewhere it does not.
          continue
        }
        /*
         * Join this pair to the previous one at the station they share.
         *
         * A pair is drawn between the FEET its two stops project to, not between
         * the stops themselves. Where consecutive pairs match different pieces of
         * the artwork, the station between them has two different feet, and the
         * space between is left undrawn — 98 units on TJ:7F at Senen, 91 on
         * MRTJ:M at Istora, 59 on TJ:6V, 72 on TJ:5C. The line reads as broken at
         * a station it plainly runs through.
         *
         * Bounded by the same distance a stop may sit from its corridor: beyond
         * that the two pairs are not describing one continuous run and a
         * connector would be inventing track, which is what the no-chord rule
         * exists to prevent.
         */
        /*
         * Refuse a pair that can only be drawn by stepping onto a parallel
         * stroke.
         *
         * The schematic never steps a line sideways mid-block: a stroke runs
         * where it runs. So when this pair's corridor sits alongside the last
         * one rather than continuing it, joining them draws a staircase that is
         * not in the artwork — 7F did this three times where its crimson and
         * koridor 2's navy run 12-24 units apart, because the pair between them
         * is detour-rejected on 7F's own stroke and has nowhere else to go.
         *
         * A gap is the honest answer, exactly as it is for a pair that matches
         * nothing: the line is not drawn there, and saying so beats inventing a
         * jog between two lines' strokes.
         */
        if (!bridgeFromPrevious(edges, match.path)) {
          lastCorridor = undefined
          continue
        }
        lastCorridor = match.index
        for (let j = 0; j < match.path.length - 1; j++) {
          const [ax, ay] = match.path[j]
          const [bx, by] = match.path[j + 1]
          edges.push([ax, ay, bx, by])
        }
        segMatched++
      }
    }

    matchedPairs += segMatched
    totalPairs += segTotal
    segments.push({
      kind: segment.kind,
      edges,
      markers: resolved.map(r => r.id),
      matchedPairs: segMatched,
      totalPairs: segTotal
    })
  }

  return { segments, matchedPairs, totalPairs, tracedColour }
}
