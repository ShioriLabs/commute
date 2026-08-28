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
 * Gated: 128 of 132 adjacent pairs traced (97%). Colour-blind: 130 traced, but
 * TEN of them onto a stroke of the wrong colour — LRTJBDB:CB alone puts 6 of its
 * 11 pairs on another line. So the gate costs 2 traced pairs and buys back 10
 * confidently wrong ones.
 *
 * It also rescues rather than only rejecting: KCI:T and LRTJBDB:BK trace 100%
 * *and* avoid a wrong stroke, because filtering the candidates before the
 * election steers them onto their own line instead of a nearer neighbour.
 *
 * The two pairs it gives up are real refusals, not near misses. KCI:A's first
 * pair matches a cyan corridor 155 channels from its navy brand; KCI:C hits one
 * at 142. Both would have lit a different line end to end.
 *
 * Pure and synchronous: takes already-fetched line detail and geometry so the
 * build script and the tests drive it the same way.
 */

import { colourMatches } from './map-corridor-colour'
import {
  matchCorridorPath,
  pickLegCorridor,
  prepareCorridors,
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
  colours: ReadonlyArray<string | null>,
  lineColour: string | undefined
): number | undefined {
  const eligible: number[] = []
  for (let i = 0; i < prepared.length; i++) {
    if (colourMatches(colours[i] ?? null, lineColour)) eligible.push(i)
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

export function traceLine(
  line: TraceableLine,
  points: readonly TracePoint[],
  corridors: readonly Corridor[],
  // Artwork colour per corridor, aligned by index; see corridorColours(). Null
  // entries are "unknown", never "excluded".
  corridorColour: ReadonlyArray<string | null>,
  // The line's brand colour. Undefined disables the colour gate entirely, which
  // is the pre-existing colour-blind behaviour.
  lineColour: string | undefined
): TracedLine {
  // First alias wins, but an exact id always beats an alias — the same rule the
  // route overlay uses, so a station drawn twice pins the same shape in both.
  const byStation = new Map<string, TracePoint>()
  for (const p of points) {
    const stationId = stationIdOf(p)
    if (p.id === stationId || !byStation.has(stationId)) byStation.set(stationId, p)
  }

  const prepared = corridors.length > 0 ? prepareCorridors(corridors) : []
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
      const preferIndex = electCorridor(resolved, prepared, corridorColour, lineColour)
      for (let i = 0; i < resolved.length - 1; i++) {
        const a = resolved[i]
        const b = resolved[i + 1]
        const match = matchCorridorPath(a.x, a.y, b.x, b.y, prepared, { preferIndex })
        // No chord fallback. An unmatched pair leaves a gap in the isolated line,
        // which is the honest answer; a straight chord across the artwork would
        // claim the line runs somewhere it does not.
        if (!match) continue
        // The elected corridor can still be the wrong colour where the election
        // fell through to colour-blind matching, so re-check what was actually
        // traced rather than trusting the preference.
        if (!colourMatches(corridorColour[match.index] ?? null, lineColour)) continue
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
