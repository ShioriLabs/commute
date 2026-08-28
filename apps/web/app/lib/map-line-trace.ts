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
 * That is why this adds a colour gate the route overlay does not have (see
 * map-corridor-colour.ts) and why an unmatched pair contributes NOTHING rather
 * than falling back to a chord. A gap in the isolated line is honest; a chord
 * across the map, or a neighbouring line lit up, is not.
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
 * With the shared-track exception (see colourMatches) it traces 133 of 136. The
 * three it still gives up are honest: two sit on a navy stroke near Duri and
 * Tanah Abang that no line serving those stops is drawn in, so there is nothing
 * to tell it apart from a neighbour, and refusing leaves a gap rather than
 * lighting the wrong line.
 *
 * Pure and synchronous: takes already-fetched line detail and geometry so the
 * build script and the tests drive it the same way.
 */

import { colourMatches } from './map-corridor-colour'
import {
  CORRIDOR_MATCH_MAX_DIST_WORLD,
  matchCorridorPath,
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
  lineColour: string | undefined
): number | undefined {
  const eligible: number[] = []
  for (let i = 0; i < prepared.length; i++) {
    if (colourMatches(colourAt(i), lineColour)) eligible.push(i)
  }

  if (eligible.length > 0 && eligible.length < prepared.length) {
    const subset = eligible.map(i => prepared[i])
    const picked = pickLegCorridor(stops, subset)
    if (picked !== undefined) return eligible[picked]
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

function joinsEndToEnd(a: PreparedCorridor, b: PreparedCorridor): [number, number] | null {
  for (const p of corridorEndpoints(a)) {
    for (const q of corridorEndpoints(b)) {
      if (Math.hypot(p[0] - q[0], p[1] - q[1]) <= JOIN_EPSILON_WORLD) return [p[0], p[1]]
    }
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
): Array<[number, number, number, number]> | null {
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
        for (let k = 0; k < path.length - 1; k++) {
          edges.push([path[k][0], path[k][1], path[k + 1][0], path[k + 1][1]])
        }
      }
      if (edges.length > 0) return edges
    }
  }
  return null
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
  sharedTrack?: SharedTrackLookup
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
  const segments: TracedSegment[] = []
  let matchedPairs = 0
  let totalPairs = 0

  for (const segment of line.segments) {
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
      const p = byStation.get(id)
      if (!p) continue
      resolved.push({ id, x: (p.ax + p.bx) / 2, y: (p.ay + p.by) / 2 })
    }

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
      const preferIndex = electCorridor(resolved, prepared, colourAt, lineColour)
      for (let i = 0; i < resolved.length - 1; i++) {
        const a = resolved[i]
        const b = resolved[i + 1]
        const shared = sharedTrack ? sharedTrack(a.id, b.id) : undefined
        const eligible = (index: number) => colourMatches(colourAt(index), lineColour, shared)
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
        const strict = (index: number) => colourMatches(colourAt(index), lineColour)
        const match = matchWithinEligible(a, b, prepared, strict, preferIndex)
          ?? matchWithinEligible(a, b, prepared, eligible, preferIndex)
        if (!match) {
          // Nothing reaches both stops. Before giving up, try the one shape the
          // artwork's own breaks produce: two corridors meeting end to end.
          // Strict first here too, for the reason given above: the chain should
          // not reach for a neighbour's colour while this line's own stroke is
          // available on both halves.
          const chained = matchAcrossJoin(a, b, prepared, strict)
            ?? matchAcrossJoin(a, b, prepared, eligible)
          if (chained) {
            edges.push(...chained)
            segMatched++
          }
          // Otherwise leave a gap. No chord fallback: a straight line across the
          // artwork would claim the line runs somewhere it does not.
          continue
        }
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

  return { segments, matchedPairs, totalPairs }
}
