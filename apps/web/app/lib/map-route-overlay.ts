import type { FareResult } from '@commute/schemas'
import { hexToRgb01 } from 'utils/colors'
import type { Point, RouteOverlay, RouteSegment } from './map-renderer'
import { colourMatches } from './map-corridor-colour'
import { CORRIDOR_MATCH_MAX_DIST_WORLD, matchCorridorPath, pickLegCorridor, pointAtArcLength, polylineLength, prepareCorridors, projectOntoPolyline, type Corridor } from './map-corridors'
import {
  dashSegment,
  pointStationId,
  ROUTE_LINE_HALF_WIDTH_BRT_WORLD,
  ROUTE_LINE_HALF_WIDTH_WORLD,
  ROUTE_PIN_RADIUS_WORLD,
  ROUTE_STOP_RADIUS_BRT_WORLD,
  ROUTE_STOP_RADIUS_WORLD,
  ROUTE_TRANSFER_DASH_WORLD,
  ROUTE_TRANSFER_GAP_WORLD
} from './map-renderer'

// Neutral connector color for transfers — no line owns a walk.
const TRANSFER_COLOR: [number, number, number] = [0.42, 0.45, 0.5]

// Same grey as TRANSFER_COLOR, in the hex form the line lookup returns.
const FALLBACK_LINE_COLOR = '#6B7380'

/*
 * When a matched corridor sub-path counts as "straight, so use the stops' own
 * line instead" — see the note at the match site.
 *
 * The ratio tolerates only collinear-vertex float noise: a genuine dogleg is
 * ≥1.002 even when gentle. The offset is the interlined-band scale, and it has
 * to cover the band's FULL stroke separation (~22 units), not half of it: tap
 * targets inside a band are authored inconsistently — some straddle midway,
 * some sit ON one stroke (Damai and Jelambar do) — so a stop can legitimately
 * be a whole stroke-gap from the stroke that continues past it. Still well
 * under the ~40 of an interchange bar or the ~43 of a junction gap, which must
 * stay corridor-drawn.
 */
const STRAIGHT_SUBPATH_MAX_RATIO = 1.001
const STRAIGHT_SUBPATH_MAX_OFFSET_WORLD = 25

export interface RouteOverlayModel {
  overlay: RouteOverlay
  // World-space extent of everything drawn, pin radius included — the camera
  // fit-bounds target.
  bbox: { minX: number, minY: number, maxX: number, maxY: number }
}

// Resolve fare legs + the selected pair against the map's points into drawable
// overlay geometry. Stop ids missing from points are a NORMAL case, not an
// error: points.json covers only stations drawn on the FDTJ schematic, and TJ
// topology-only stops aren't. Those vertices are skipped and the polyline
// chords across the gap. `fare` may be null (loading, error, single endpoint):
// the pins still resolve straight from the pair, so the map answers a deep
// link immediately.
/*
 * pickLegCorridor restricted to the strokes this leg could be drawn in.
 *
 * Indices are remapped rather than passing a predicate, because pickLegCorridor
 * reports a position in the array it was handed and the caller needs an index
 * into the real corridor list.
 */
function electLegCorridor(
  vertices: ReadonlyArray<{ x: number, y: number }>,
  prepared: readonly ReturnType<typeof prepareCorridors>[number][],
  eligible: ((index: number) => boolean) | undefined
): number | undefined {
  if (!eligible) return pickLegCorridor(vertices, prepared)
  const indices: number[] = []
  for (let i = 0; i < prepared.length; i++) if (eligible(i)) indices.push(i)
  if (indices.length === 0) return pickLegCorridor(vertices, prepared)
  const picked = pickLegCorridor(vertices, indices.map(i => prepared[i]))
  return picked !== undefined ? indices[picked] : pickLegCorridor(vertices, prepared)
}

export function buildRouteOverlayModel(
  /*
   * Only `legs` is read, so this takes the shape rather than either named type.
   * A FareResult and one FareJourney out of a TripResult are both valid here —
   * which is the point, since the map now draws whichever journey the rider
   * selected rather than the only one on offer.
   */
  fare: Pick<FareResult, 'legs'> | null,
  routePair: { fromId: string | null, toId: string | null },
  points: Point[],
  // Line colours live on /operators, not on the leg — a ride leg only names its
  // line key. Passed in rather than looked up here so this stays a pure
  // function the tests can drive without SWR.
  resolveLine: (key: string | undefined) => { colorCode: string } | undefined,
  // The schematic's drawn corridors, so a ride leg traces the line instead of
  // chording between stations. Optional throughout: the file is fetched
  // separately and may not have landed yet, and every pair falls back to a
  // chord without it.
  corridors?: readonly Corridor[] | null
): RouteOverlayModel | null {
  // Falls back to the transfer grey rather than black: /operators may still be
  // in flight when a deep link paints its first overlay, and a neutral line
  // reads as "colour pending" instead of as a deliberate black line.
  const lineColor = (key: string | undefined) => resolveLine(key)?.colorCode ?? FALLBACK_LINE_COLOR
  const byStation = new Map<string, Point>()
  for (const p of points) {
    // First alias wins, but an exact id always beats an alias: stations drawn
    // in more than one place (Point.station) must pin their primary shape.
    const stationId = pointStationId(p)
    if (p.id === stationId || !byStation.has(stationId)) byStation.set(stationId, p)
  }

  const missing: string[] = []
  const centroid = (stationId: string | null | undefined): { x: number, y: number } | null => {
    if (!stationId) return null
    const p = byStation.get(stationId)
    if (!p) {
      missing.push(stationId)
      return null
    }
    return { x: (p.ax + p.bx) / 2, y: (p.ay + p.by) / 2 }
  }

  // Prepared once per build, not per pair: every pair re-scans every corridor,
  // and the arc-length tables would otherwise be rebuilt for each one.
  const prepared = corridors && corridors.length > 0 ? prepareCorridors(corridors) : null

  const segments: RouteSegment[] = []
  const stops: RouteOverlay['pins'] = []
  // Station centroid -> where the drawn route actually passes it. Only differs
  // for stations whose tap target spans several corridors (interchange bars).
  const snapped = new Map<string, { x: number, y: number }>()
  const pushDashes = (a: { x: number, y: number }, b: { x: number, y: number }) => {
    for (const d of dashSegment(a.x, a.y, b.x, b.y, ROUTE_TRANSFER_DASH_WORLD, ROUTE_TRANSFER_GAP_WORLD)) {
      segments.push({ ...d, r: ROUTE_LINE_HALF_WIDTH_WORLD, color: TRANSFER_COLOR, kind: 'transfer' })
    }
  }

  // Where the previous leg's drawn geometry ended: legs that abut without a
  // TRANSFER between them (or around an unresolvable transfer endpoint) still
  // get a dashed bridge instead of a bare gap.
  let cursor: { x: number, y: number } | null = null
  for (const leg of fare?.legs ?? []) {
    if (leg.type === 'RIDE') {
      const vertices = leg.stops
        .map(stop => centroid(stop.id))
        .filter((v): v is { x: number, y: number } => v !== null)
      if (vertices.length === 0) continue
      const color = hexToRgb01(lineColor(leg.line))
      // Match the corridor this leg rides: the artwork draws BRT thinner than
      // rail, and a rail-width line over a BRT corridor buries it.
      const isBrt = leg.operator === 'TJ'
      const halfWidth = isBrt ? ROUTE_LINE_HALF_WIDTH_BRT_WORLD : ROUTE_LINE_HALF_WIDTH_WORLD
      const stopRadius = isBrt ? ROUTE_STOP_RADIUS_BRT_WORLD : ROUTE_STOP_RADIUS_WORLD
      /*
       * Where the drawn route actually meets each station, which is not always
       * the tap target's centroid.
       *
       * An interchange like Manggarai is authored as one bar spanning several
       * parallel corridors ~40 units apart, so its centroid sits BETWEEN the
       * lines — on none of them. A marker placed there floats off the line the
       * rider is on. The matched corridor sub-path already ends exactly where
       * the ridden line passes the station, so use that when there is one and
       * fall back to the centroid when the pair chorded.
       */
      const marks = vertices.map(v => ({ x: v.x, y: v.y }))
      /*
       * The corridor this leg belongs to, elected ONCE from all of its stops
       * and held fixed for every pair. A rolling preference (keep whatever the
       * previous pair used) was tried and reverted: it made the drawn route
       * depend on travel direction, because the leg committed to whichever of
       * two parallel strokes its first pair happened to reach — Roxy→Kalideres
       * rode the neighbouring 2A stroke that Kalideres→Roxy did not.
       */
      /*
       * Which corridors this leg is allowed to ride, by artwork colour.
       *
       * Distance alone cannot separate two strokes drawn on one alignment, and
       * where it guesses wrong the route is drawn along a DIFFERENT line's
       * colour: Koridor 3's yellow legs traced onto a blue stub 213 channels
       * away, because the stub happened to sit a world unit nearer. Filtering
       * before the election, rather than vetting the winner after it, is what
       * keeps the right stroke in the running when a neighbour is marginally
       * closer.
       *
       * A hex is shared by several lines here — 17 BRT colours cover 100 TJ
       * lines, grouped by koridor family — so this narrows a stroke to a family
       * and never to one line. That is enough to stop a leg riding another
       * koridor's stroke, which is the whole failure.
       *
       * Falls back to colour-blind when nothing survives, so a stretch drawn in
       * a colour we cannot account for still draws rather than vanishing.
       */
      const legColourHex = lineColor(leg.line)
      // Read the colour off the PREPARED corridor, not the raw array: preparing
      // drops any corridor with fewer than two points, so the two are not index-
      // aligned and indexing the raw one would gate on a neighbour's colour.
      const eligible = prepared
        ? (index: number) => colourMatches(prepared[index]?.c ?? null, legColourHex)
        : undefined
      const anyEligible = prepared
        ? prepared.some((_, index) => eligible!(index))
        : false
      const legEligible = anyEligible ? eligible : undefined
      const preferIndex = prepared ? electLegCorridor(vertices, prepared, legEligible) : undefined
      /*
       * Where the previous pair's drawn geometry ended. Consecutive pairs can
       * legitimately land on different strokes — the elected corridor ends and
       * the leg continues on its neighbour — and their sub-paths do not share
       * an endpoint: at Jelambar the elected stroke sits 22 units from the one
       * carrying the route on to Grogol, and without a connector the two bars
       * simply butt past each other at different heights. A short ride segment
       * bridges every such seam, chords included, so a leg is one continuous
       * line no matter how many strokes it crosses.
       */
      let prevEnd: { x: number, y: number } | null = null
      const bridgeTo = (x: number, y: number) => {
        if (prevEnd && (prevEnd.x !== x || prevEnd.y !== y)) {
          segments.push({ ax: prevEnd.x, ay: prevEnd.y, bx: x, by: y, r: halfWidth, color, kind: 'ride' })
        }
      }
      /*
       * Plan first, emit second — the leg-level straightening below needs to
       * know every pair's verdict before anything is drawn.
       *
       * A corridor sub-path earns its keep by CURVING — that is the whole
       * feature. When the sub-path is straight, it contributes no shape the
       * stops don't already have; all it adds is a parallel offset, because
       * on an interlined band the artwork draws several strokes side by side
       * and the tap targets sit between them on the straddling halte circles.
       * So a straight sub-path whose ends are within the band scale of the
       * stops defers to the stops' own line (`path: null` below). Beyond the
       * band scale the offset is a real fact worth keeping — an interchange
       * bar's centroid sits ~40 units off its corridor, and RSPAD reaches its
       * partner's stroke at 43 — so those stay corridor-drawn (and snapped).
       */
      const plans: Array<{ a: { x: number, y: number }, b: { x: number, y: number }, i: number, path: Array<[number, number]> | null }> = []
      for (let i = 1; i < vertices.length; i++) {
        const a = vertices[i - 1]
        const b = vertices[i]
        if (a.x === b.x && a.y === b.y) continue
        // Corridor first, chord as the fallback — a pair whose stops aren't both
        // near one drawn corridor (or whose only candidate detours the long way)
        // still gets a straight connector rather than nothing.
        const match = prepared
          ? matchCorridorPath(a.x, a.y, b.x, b.y, prepared, { preferIndex, eligible: legEligible })
          : null
        const path = match?.path
        let corridorAddsShape = false
        if (match && path) {
          const first = path[0]
          const last = path[path.length - 1]
          const offA = Math.hypot(a.x - first[0], a.y - first[1])
          const offB = Math.hypot(b.x - last[0], b.y - last[1])
          const endToEnd = Math.hypot(last[0] - first[0], last[1] - first[1])
          const straight = endToEnd > 0 && polylineLength(path) <= endToEnd * STRAIGHT_SUBPATH_MAX_RATIO
          corridorAddsShape = !straight
            || offA > STRAIGHT_SUBPATH_MAX_OFFSET_WORLD
            || offB > STRAIGHT_SUBPATH_MAX_OFFSET_WORLD
        }
        plans.push({ a, b, i, path: match && path && corridorAddsShape ? path : null })
      }

      /*
       * Leg-level straightening: put a ruler on the leg.
       *
       * Chording pair by pair is not enough for a straight run, because the
       * tap targets themselves drift within the band — Koridor 3's western
       * haltes sit ON its own stroke while the interlined stretch straddles
       * 11 units off it, so per-pair chords kink where the band begins. When
       * no pair kept corridor shape and every stop lies within the band scale
       * of one line, the whole leg IS that line: one segment, every marker
       * projected onto it.
       *
       * The ruler lies ON the elected corridor's own stroke, not through the
       * centroids: the route should sit on the drawn line itself — dots on the
       * line, the way rail stations sit on theirs — and a centroid line floats
       * between the band's strokes at whatever level the tap targets happened
       * to be authored. The stroke's line is extended past its drawn end, so
       * stops beyond it (Grogol and Roxy, where Koridor 3's stroke has already
       * turned off) still land on the same straight line. Only when no
       * corridor was elected does the first→last centroid line stand in.
       *
       * Gated on corridors being loaded, and a curved pair or an over-scale
       * stop anywhere vetoes it.
       */
      let flattened = false
      if (prepared && plans.length > 0 && plans.every(plan => plan.path === null)) {
        // Axis as point + unit direction, projections unclamped so the line
        // extends beyond whatever defined it.
        let axis: { x: number, y: number, ux: number, uy: number } | null = null
        if (preferIndex !== undefined) {
          const corridor = prepared[preferIndex]
          const feet: Array<[number, number]> = []
          for (const v of vertices) {
            const projection = projectOntoPolyline(v.x, v.y, corridor)
            if (projection.dist <= CORRIDOR_MATCH_MAX_DIST_WORLD) {
              feet.push(pointAtArcLength(corridor, projection.s))
            }
          }
          if (feet.length >= 2) {
            const [fx, fy] = feet[0]
            const [lx, ly] = feet[feet.length - 1]
            const len = Math.hypot(lx - fx, ly - fy)
            if (len > 0) {
              const candidate = { x: fx, y: fy, ux: (lx - fx) / len, uy: (ly - fy) / len }
              // The feet must actually be collinear — an elected corridor
              // whose serving run bends cannot be a ruler.
              const colinear = feet.every(([x, y]) => {
                const cross = (x - candidate.x) * candidate.uy - (y - candidate.y) * candidate.ux
                return Math.abs(cross) <= 0.75
              })
              if (colinear) axis = candidate
            }
          }
        }
        if (!axis) {
          const v0 = vertices[0]
          const vN = vertices[vertices.length - 1]
          const len = Math.hypot(vN.x - v0.x, vN.y - v0.y)
          if (len > 0) axis = { x: v0.x, y: v0.y, ux: (vN.x - v0.x) / len, uy: (vN.y - v0.y) / len }
        }
        if (axis) {
          const project = (p: { x: number, y: number }) => {
            const t = (p.x - axis.x) * axis.ux + (p.y - axis.y) * axis.uy
            return { x: axis.x + t * axis.ux, y: axis.y + t * axis.uy }
          }
          const withinBand = vertices.every((v) => {
            const foot = project(v)
            return Math.hypot(v.x - foot.x, v.y - foot.y) <= STRAIGHT_SUBPATH_MAX_OFFSET_WORLD
          })
          if (withinBand) {
            const start = project(vertices[0])
            const end = project(vertices[vertices.length - 1])
            segments.push({ ax: start.x, ay: start.y, bx: end.x, by: end.y, r: halfWidth, color, kind: 'ride' })
            vertices.forEach((v, i) => {
              marks[i] = project(v)
            })
            flattened = true
          }
        }
      }

      if (!flattened) {
        for (const plan of plans) {
          const { a, b, i, path } = plan
          if (path) {
            bridgeTo(path[0][0], path[0][1])
            // The later pair wins a shared station's position, so the handoff
            // stop's dot sits where the line continues from rather than behind it.
            marks[i - 1] = { x: path[0][0], y: path[0][1] }
            marks[i] = { x: path[path.length - 1][0], y: path[path.length - 1][1] }
            for (let k = 1; k < path.length; k++) {
              segments.push({
                ax: path[k - 1][0],
                ay: path[k - 1][1],
                bx: path[k][0],
                by: path[k][1],
                r: halfWidth,
                color,
                kind: 'ride'
              })
            }
            prevEnd = { x: path[path.length - 1][0], y: path[path.length - 1][1] }
            continue
          }
          bridgeTo(a.x, a.y)
          segments.push({
            ax: a.x,
            ay: a.y,
            bx: b.x,
            by: b.y,
            r: halfWidth,
            color,
            kind: 'ride'
          })
          prevEnd = { x: b.x, y: b.y }
        }
      }
      // Bridge from the previous leg only now that this one's first mark is
      // known: the dash has to reach where this leg is actually drawn, not the
      // centroid it was matched from, or it stops short of its own marker.
      if (cursor && (cursor.x !== marks[0].x || cursor.y !== marks[0].y)) {
        pushDashes(cursor, marks[0])
      }
      // A dot at every station this leg calls at, in the ridden line's colour —
      // the schematic's own marker idiom, so Manggarai reads as a Cikarang stop
      // while you are on Cikarang. The journey's two ends are drawn separately
      // as pins and would only be covered by a dot, so they are skipped there.
      for (const mark of marks) {
        stops.push({ x: mark.x, y: mark.y, kind: 'stop', color, r: stopRadius })
      }
      // Keyed by the station's own centroid, so the end pins can find where
      // their marker was actually placed — see snapped below.
      vertices.forEach((v, i) => {
        const key = `${v.x}|${v.y}`
        if (!snapped.has(key)) snapped.set(key, marks[i])
      })
      cursor = marks[marks.length - 1]
    } else {
      // TRANSFER: the dashes come from the cursor (last drawn vertex) to the
      // far end, so a leg endpoint that chorded away doesn't double-bridge.
      const to = centroid(leg.to.id)
      if (cursor && to && (cursor.x !== to.x || cursor.y !== to.y)) {
        pushDashes(cursor, to)
        cursor = to
      }
    }
  }

  /*
   * The ends take the colour of the leg that touches them — the line you board
   * at the origin, the one you alight from at the destination — so the whole
   * chain of markers belongs to the line it sits on.
   *
   * Falls back to ink when the fare hasn't resolved: a deep link paints its
   * pins before it knows what line will serve them.
   */
  const colorAt = (x: number, y: number, which: 'first' | 'last') => {
    const matches = stops.filter(stop => stop.x === x && stop.y === y)
    return (which === 'first' ? matches[0] : matches[matches.length - 1])?.color
  }
  // An end pin belongs on the ridden line, exactly like the stop dots — an
  // interchange bar's centroid sits between its corridors, so a raw centroid
  // would float the arrow off the line it is supposed to mark.
  const snap = (p: { x: number, y: number }) => snapped.get(`${p.x}|${p.y}`) ?? p

  const pins: RouteOverlay['pins'] = []
  const originCentroid = centroid(routePair.fromId)
  // first vs last matters only when a station is served twice in one journey:
  // you board the origin on the FIRST leg to touch it and alight at the
  // destination from the LAST.
  if (originCentroid) {
    const origin = snap(originCentroid)
    pins.push({ x: origin.x, y: origin.y, kind: 'origin', color: colorAt(origin.x, origin.y, 'first') })
  }
  const destinationCentroid = centroid(routePair.toId)
  if (destinationCentroid) {
    const destination = snap(destinationCentroid)
    pins.push({
      x: destination.x,
      y: destination.y,
      kind: 'destination',
      color: colorAt(destination.x, destination.y, 'last')
    })
  }

  /*
   * Stop dots, minus the ones that would be drawn over anyway.
   *
   * Two sources of duplicates: the journey's own ends (an end pin covers the
   * dot, so it is wasted geometry), and interchanges, where the arriving and
   * departing legs both call at the station and would stack two dots in
   * different colours — the second silently winning. Keeping the first means
   * the line you ARRIVE on owns the dot.
   */
  const placed = new Set(pins.map(pin => `${pin.x}|${pin.y}`))
  for (const stop of stops) {
    const key = `${stop.x}|${stop.y}`
    if (placed.has(key)) continue
    placed.add(key)
    pins.push(stop)
  }

  if (missing.length > 0) {
    console.warn('route overlay: no map point for', missing.join(', '))
  }
  if (segments.length === 0 && pins.length === 0) return null

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  const extend = (x: number, y: number, margin: number) => {
    minX = Math.min(minX, x - margin)
    minY = Math.min(minY, y - margin)
    maxX = Math.max(maxX, x + margin)
    maxY = Math.max(maxY, y + margin)
  }
  for (const s of segments) {
    extend(s.ax, s.ay, s.r)
    extend(s.bx, s.by, s.r)
  }
  // Each pin padded by its own footprint: a stop dot is half an end pin, and
  // over-padding them would quietly widen the camera's fit for every station in
  // between.
  for (const pin of pins) {
    extend(pin.x, pin.y, pin.kind === 'stop' ? (pin.r ?? ROUTE_STOP_RADIUS_WORLD) : ROUTE_PIN_RADIUS_WORLD)
  }

  return { overlay: { segments, pins }, bbox: { minX, minY, maxX, maxY } }
}
