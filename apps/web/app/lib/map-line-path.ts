/*
 * Reading a ride's geometry off the traced lines, instead of matching for it.
 *
 * The route overlay's other source, map-corridors.json, is the raw artwork: a
 * corridor knows its colour and its width, not which line it is. Everything in
 * map-route-overlay.ts that elects a corridor, gates it on colour and mode, and
 * then straightens the result exists to recover the one fact the artwork does
 * not carry — identity — from geometry alone.
 *
 * map-lines.json already has it. Tracing happened at build time
 * (scripts/build-map-lines.ts), keyed OPERATOR:CODE, which is exactly the key a
 * ride leg names its line by. So for a traced line the answer is a lookup, and
 * this module is that lookup.
 *
 * What the manifest does NOT record is where along a segment's stroke each of
 * its stations sits: the tracer emits a contiguous edge list and an ordered
 * marker list, and nothing tying the two together. That position is recovered
 * here by projecting each station's point onto the stroke — sound because the
 * stroke IS the station's own line, so it projects onto it at a median of 2.6
 * world units across the shipped network.
 */

import type { LinesManifest } from './map-line-isolate'
import {
  extractSubPolyline,
  pointAtArcLength,
  prepareCorridor,
  projectOntoPolyline,
  type PreparedCorridor
} from './map-corridors'
import { pointStationId, type Point } from './map-renderer'

/*
 * How far a station may sit from its own traced stroke and still be sliced
 * from it, world units.
 *
 * Measured over all 889 station-on-segment projections in the shipped manifest:
 * median 2.6, p90 23.4, and only 10 beyond 60. Those 10 are not noise — they
 * land on the lines whose traces are known to be incomplete (TJ:10D at 16/20
 * pairs, TJ:4 at 19/21, TJ:4D at 24/27), plus a few stations at a junction
 * break. Where the trace has a hole, the station projects clear across it, onto
 * a stretch of stroke it has no business riding: TJ:10D's four gap stations
 * project 1813 to 2022 units away. Slicing from there would draw the route down
 * the wrong piece of artwork with full confidence, which is worse than not
 * drawing it, so those pairs are refused and fall back to the corridor matcher.
 *
 * 60 sits in the middle of a plateau rather than on a slope: thresholds of 50,
 * 60 and 70 all traced the identical 775 of 790 adjacent pairs, because there
 * is simply nothing between 48 and 70. The midpoint is the most tolerant place
 * to put it if a re-tile nudges the artwork, the same reasoning the BRT/rail
 * width split uses.
 *
 * Deliberately far tighter than CORRIDOR_MATCH_MAX_DIST_WORLD (110). That slack
 * exists so a matcher can still find SOME corridor for a stop stranded by a
 * junction break; this gate is asking a different question — whether the
 * traced stroke can be trusted for this pair — and a stop that far off its own
 * line is the signal that it cannot.
 */
export const TRACED_PATH_MAX_OFFSET_WORLD = 60

/*
 * Where a joint stops being float noise and becomes a real break in the stroke,
 * world units.
 *
 * The two are not close. Across every joint in the shipped manifest, 24 carry a
 * nonzero gap of 0.29 or less — the tracer's own accumulated float error — and
 * 5 carry one of 282 or more, where a line's stroke is genuinely drawn in
 * separate pieces. Nothing at all falls between, so 1 sits in a void three
 * orders of magnitude wide and cannot be tripped by either.
 *
 * Worth stating because getting it wrong is quiet: at 0.001 the noise reads as
 * a break, MRTJ's 50-edge trunk truncates to its first edge, and every pair on
 * the line falls back to matching while still looking traced.
 */
const STROKE_JOINT_TOLERANCE_WORLD = 1

/*
 * One traced segment, ready to slice: its stroke as a polyline, and where each
 * of its stations lands on it.
 *
 * `stops` is parallel to the segment's own marker list, positions and all. A
 * LOOP repeats its first station as its last to close the ring, so the same id
 * genuinely occupies two positions at different arc lengths — keying by id
 * would collapse them and lose the ride's direction round the loop.
 */
interface PreparedSegment {
  stroke: PreparedCorridor
  stops: Array<{ id: string, s: number, dist: number } | null>
}

export interface PreparedLinePaths {
  segments: Map<string, PreparedSegment[]>
}

/*
 * Project every traced line's stations onto its own stroke, once.
 *
 * Called for the whole manifest rather than per leg: the projection walks every
 * vertex of every segment, and a route redrawn on each camera change would
 * otherwise repeat all of it.
 */
export function prepareLinePaths(
  manifest: LinesManifest | undefined,
  points: readonly Point[]
): PreparedLinePaths {
  const segments = new Map<string, PreparedSegment[]>()
  if (!manifest) return { segments }

  // First alias wins, but an exact id always beats an alias — the same rule the
  // tracer, the route overlay and lineCutShapes use, so all of them agree on
  // which shape a twice-drawn station means.
  const byStation = new Map<string, Point>()
  for (const p of points) {
    const stationId = pointStationId(p)
    if (p.id === stationId || !byStation.has(stationId)) byStation.set(stationId, p)
  }

  for (const line of manifest.lines) {
    const prepared: PreparedSegment[] = []
    for (const segment of line.segments) {
      /*
       * A broken segment becomes several strokes, not one truncated to its
       * first run.
       *
       * Five joints in the shipped manifest jump hundreds of units, where the
       * line's stroke is genuinely drawn in separate pieces. Keeping only the
       * run before the break strands every station past it: TJ:4's trunk breaks
       * 486 units at edge 29 of 41, and dropping the tail cost the seven
       * consecutive pairs beyond it, none of which is individually untraceable.
       *
       * Each piece is prepared on its own instead, so a pair riding wholly
       * within one still slices. Only a pair that would have to span the break
       * is refused, which is the honest answer — the line is not drawn there.
       */
      for (const pts of strokesOf(segment.edges)) {
        // Under two vertices there is no stroke to project onto; prepareCorridor
        // would divide by an empty cumulative table.
        if (pts.length < 2) continue
        const stroke = prepareCorridor({ pts, c: line.color, w: line.r * 2 })
        /*
         * Every marker is projected onto every piece, and the gate sorts out
         * which belongs where: a station on the far side of a break projects
         * onto this piece's nearest END, far off its own stroke, so it fails
         * the offset test here and passes on the piece that actually draws it.
         */
        const stops = segment.markers.map((id) => {
          const point = byStation.get(id)
          if (!point) return null
          const { dist, s } = projectOntoPolyline((point.ax + point.bx) / 2, (point.ay + point.by) / 2, stroke)
          return { id, s, dist }
        })
        resolveLoopWrap(stroke, stops)
        prepared.push({ stroke, stops })
      }
    }
    if (prepared.length > 0) segments.set(line.key, prepared)
  }
  return { segments }
}

/*
 * Put a loop's closing station back at the END of its stroke.
 *
 * A LOOP segment is drawn as a ring: its stroke returns to where it started, so
 * the station closing the ring sits on top of the station opening it. Both
 * project to the same spot, and projectOntoPolyline resolves that tie to the
 * LOWEST arc length by design — a deliberate choice there, so that a point on a
 * shared vertex always yields the same sub-path rather than one decided by
 * iteration order.
 *
 * Here that tie-break is wrong. It leaves the final marker at arc length 0
 * alongside the first, and the closing leg — Halimun back round to Blok M on
 * TJ:2, say — then slices from the last stop BACKWARDS across the whole ring
 * instead of forward over the short piece that actually closes it.
 *
 * Only the CLOSING marker is moved, and only when the ring's own opening marker
 * is the station it repeats. Every other stop already sits where it belongs:
 * the ring is traced in ride order, so their arc lengths climb on their own.
 * Sweeping the whole list instead — moving any stop that fell behind its
 * predecessor — cascades, because the first stop legitimately projects to 0 and
 * pins every stop after it to the far end. That collapses the entire loop onto
 * one spot, and Cikarang's 15 ring pairs all fall back rather than draw.
 */
function resolveLoopWrap(
  stroke: PreparedCorridor,
  stops: Array<{ id: string, s: number, dist: number } | null>
): void {
  const total = stroke.cums[stroke.cums.length - 1]
  if (!(total > 0)) return
  const [startX, startY] = stroke.pts[0]
  const [endX, endY] = stroke.pts[stroke.pts.length - 1]
  // Only a stroke that actually closes on itself can wrap. An open line's
  // markers are monotonic already, and 93 of the 99 shipped segments are.
  if (Math.hypot(endX - startX, endY - startY) > STROKE_JOINT_TOLERANCE_WORLD) return
  const first = stops[0]
  const last = stops[stops.length - 1]
  if (!first || !last || first === last || first.id !== last.id) return
  // Both ends of the ring are the same station projecting to the same foot;
  // the one that closes it is a lap further along.
  if (last.s <= first.s) last.s = total
}

/*
 * The traced edges as contiguous polylines — one per unbroken run.
 *
 * The tracer emits them already in ride order, so this is a chain rather than a
 * reassembly, and all but five joints in the shipped manifest close to within
 * float noise. Those five jump hundreds of units, where the line's own stroke is
 * drawn in separate pieces; stitching through one would invent a straight dash
 * across the gap, so the run ends there and a new one begins.
 */
function strokesOf(edges: readonly number[][]): Array<Array<[number, number]>> {
  const runs: Array<Array<[number, number]>> = []
  let current: Array<[number, number]> = []
  for (const [ax, ay, bx, by] of edges) {
    if (current.length === 0) current.push([ax, ay])
    else {
      const [px, py] = current[current.length - 1]
      if (Math.hypot(ax - px, ay - py) > STROKE_JOINT_TOLERANCE_WORLD) {
        runs.push(current)
        current = [[ax, ay]]
      }
    }
    current.push([bx, by])
  }
  if (current.length > 0) runs.push(current)
  return runs
}

/*
 * The stretch of `lineKey`'s traced stroke between two of its stations, in
 * travel order — or null when the trace cannot answer for this pair, which is
 * the caller's signal to fall back to matching.
 *
 * Null rather than a best effort on purpose: every reason to return it (an
 * untraced line, a station off its stroke, a gap in the trace) means the
 * geometry here would be a guess, and the corridor matcher is a better-informed
 * guess than a confident slice of the wrong artwork.
 */
export function sliceLinePath(
  prepared: PreparedLinePaths | null | undefined,
  lineKey: string | undefined,
  fromId: string,
  toId: string
): Array<[number, number]> | null {
  if (!prepared || !lineKey) return null
  const segments = prepared.segments.get(lineKey)
  if (!segments) return null

  const best = pickSegment(segments, fromId, toId)
  if (!best) return null
  const path = extractSubPolyline(best.segment.stroke, best.from.s, best.to.s)
  // Under the minimum sub-path length extractSubPolyline returns nothing: the
  // two stops resolved to effectively one spot, and a zero-length slice is not
  // geometry the overlay can draw.
  if (path.length < 2) return null
  return path
}

/*
 * Where the ridden line passes a station, even when the pair itself is not
 * sliceable — the point of it being that a station's tap target is not always
 * on its line. An interchange is authored as one bar spanning several parallel
 * strokes, so its centroid sits between them, on none.
 *
 * Exported so the overlay can put a marker on the stroke without having to
 * re-derive the projection it already computed here.
 */
export function stationFootOnLine(
  prepared: PreparedLinePaths | null | undefined,
  lineKey: string | undefined,
  stationId: string
): [number, number] | null {
  if (!prepared || !lineKey) return null
  const segments = prepared.segments.get(lineKey)
  if (!segments) return null
  let best: { segment: PreparedSegment, s: number, dist: number } | null = null
  for (const segment of segments) {
    for (const stop of segment.stops) {
      if (!stop || stop.id !== stationId) continue
      if (stop.dist > TRACED_PATH_MAX_OFFSET_WORLD) continue
      if (!best || stop.dist < best.dist) best = { segment, s: stop.s, dist: stop.dist }
    }
  }
  return best ? pointAtArcLength(best.segment.stroke, best.s) : null
}

/*
 * Which segment actually rides this pair.
 *
 * Several can carry both stations: a branch shares its junction with the trunk,
 * and in the shipped manifest that overlap is the norm rather than the
 * exception — TJ:9 shares seven stations between its trunk and its branches. A
 * segment that merely touches both ends would otherwise be free to win and draw
 * the route down a ramp it never rides.
 *
 * So adjacency in the marker list decides first: consecutive markers mean the
 * segment was traced through this pair, which is the strongest evidence there
 * is. Failing that, the shortest ride along the stroke wins, on the same
 * reasoning the corridor matcher rejects detours — the long way round a shared
 * station is not the way the line is ridden.
 */
function pickSegment(
  segments: readonly PreparedSegment[],
  fromId: string,
  toId: string
): { segment: PreparedSegment, from: { s: number }, to: { s: number } } | null {
  let best: { segment: PreparedSegment, from: { s: number }, to: { s: number }, span: number, adjacent: boolean } | null = null
  for (const segment of segments) {
    const { stops } = segment
    for (let i = 0; i < stops.length; i++) {
      const from = stops[i]
      if (!from || from.id !== fromId || from.dist > TRACED_PATH_MAX_OFFSET_WORLD) continue
      for (let j = 0; j < stops.length; j++) {
        if (i === j) continue
        const to = stops[j]
        if (!to || to.id !== toId || to.dist > TRACED_PATH_MAX_OFFSET_WORLD) continue
        const span = Math.abs(to.s - from.s)
        const adjacent = Math.abs(i - j) === 1
        // Adjacency outranks span outright: a pair the tracer walked through is
        // this pair's geometry even where some other segment happens to hold
        // the two stations closer together.
        if (!best || (adjacent && !best.adjacent) || (adjacent === best.adjacent && span < best.span)) {
          best = { segment, from, to, span, adjacent }
        }
      }
    }
  }
  return best
}
