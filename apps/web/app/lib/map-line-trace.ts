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
): Array<{ id: string, x: number, y: number }> {
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

  const resolved: Array<{ id: string, x: number, y: number }> = []
  for (const id of ids) {
    const point = byStation.get(id)
    if (!point) continue
    resolved.push({ id, x: (point.ax + point.bx) / 2, y: (point.ay + point.by) / 2 })
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
  head: readonly [number, number] | undefined
): void {
  const previous = edges[edges.length - 1]
  if (!previous || !head) return
  const step = Math.hypot(head[0] - previous[2], head[1] - previous[3])
  if (step <= MIN_BRIDGE_LENGTH_WORLD || step > MAX_STATION_BRIDGE_WORLD) return
  edges.push([previous[2], previous[3], head[0], head[1]])
}

// The worse of a pair's two projection distances onto one corridor.
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
  a: { x: number, y: number },
  b: { x: number, y: number },
  prepared: readonly PreparedCorridor[],
  eligible: (index: number) => boolean
): { edges: Array<[number, number, number, number]>, fit: number } | null {
  let best: Array<[number, number, number, number]> | null = null
  let bestFit = Infinity
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
      const fit = Math.max(
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
      if (fit < bestFit) {
        bestFit = fit
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

  for (let segmentIndex = 0; segmentIndex < line.segments.length; segmentIndex++) {
    const segment = line.segments[segmentIndex]
    const resolved = resolvedBySegment[segmentIndex]

    const edges: Array<[number, number, number, number]> = []
    let segMatched = 0
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
        const eligible = (index: number) => modeOk(index) && carriesLine(index) && colourMatches(colourAt(index), tracedColour, shared)
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
        const carriesLine = (index: number): boolean => {
          if (isBrt !== true || preferIndex === undefined) return true
          if (electedServes < MIN_ELECTED_STOPS_TO_JUDGE) return true
          /*
           * A piece drawn in the elected corridor's OWN FAMILY is this line's
           * stroke, however short — the artwork breaks a corridor into many
           * pieces and most carry only a stop or two.
           *
           * Compared within CORRIDOR_COLOUR_TOLERANCE rather than for an exact
           * hex match: the sheet draws one koridor in several near-identical
           * shades (TJ:7F's own stroke appears as #F71752 and #89070E, 65 apart),
           * and demanding equality refused the line its own ink — which then fell
           * through to the shared-track relaxation and took koridor 2's navy, 216
           * away. Only a stroke from a DIFFERENT family has to earn its place by
           * carrying the line.
           */
          const electedInk = colourAt(preferIndex)
          const ink = colourAt(index)
          if (electedInk && ink && channelDistance(ink, electedInk) <= CORRIDOR_COLOUR_TOLERANCE) return true
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
        const own = matchWithinEligible(a, b, prepared, strict, preferIndex)
        const ownChain = own ? null : matchAcrossJoin(a, b, prepared, strict)
        if (!own && ownChain) {
          if (ownChain.edges.length > 0) {
            bridgeFromPrevious(edges, [ownChain.edges[0][0], ownChain.edges[0][1]])
          }
          edges.push(...ownChain.edges)
          segMatched++
          continue
        }
        const match = own ?? matchWithinEligible(a, b, prepared, eligible, preferIndex)
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
          if (
            chained
            && (isBrt === true
              ? chained.fit <= CHAIN_MAX_FIT_WORLD_BRT && chained.fit < directFit
              : chained.fit * CHAIN_PREFERENCE_MARGIN_RAIL < directFit)
          ) {
            if (chained.edges.length > 0) {
              bridgeFromPrevious(edges, [chained.edges[0][0], chained.edges[0][1]])
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
              bridgeFromPrevious(edges, [chained.edges[0][0], chained.edges[0][1]])
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
        bridgeFromPrevious(edges, match.path[0])
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
