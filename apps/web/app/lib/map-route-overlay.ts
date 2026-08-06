import type { FareResult } from '@commute/schemas'
import { hexToRgb01 } from 'utils/colors'
import type { Point, RouteOverlay, RouteSegment } from './map-renderer'
import { matchCorridorPath, prepareCorridors, type Corridor } from './map-corridors'
import {
  dashSegment,
  pointStationId,
  ROUTE_LINE_HALF_WIDTH_WORLD,
  ROUTE_PIN_RADIUS_WORLD,
  ROUTE_STOP_RADIUS_WORLD,
  ROUTE_TRANSFER_DASH_WORLD,
  ROUTE_TRANSFER_GAP_WORLD
} from './map-renderer'

// Neutral connector color for transfers — no line owns a walk.
const TRANSFER_COLOR: [number, number, number] = [0.42, 0.45, 0.5]

// Same grey as TRANSFER_COLOR, in the hex form the line lookup returns.
const FALLBACK_LINE_COLOR = '#6B7380'

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
export function buildRouteOverlayModel(
  fare: FareResult | null,
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
      for (let i = 1; i < vertices.length; i++) {
        const a = vertices[i - 1]
        const b = vertices[i]
        if (a.x === b.x && a.y === b.y) continue
        // Corridor first, chord as the fallback — a pair whose stops aren't both
        // near one drawn corridor (or whose only candidate detours the long way)
        // still gets a straight connector rather than nothing.
        const path = prepared ? matchCorridorPath(a.x, a.y, b.x, b.y, prepared) : null
        if (path) {
          // The first pair to touch a station wins its position, matching how
          // the dedup below hands an interchange to the line you arrive on.
          marks[i - 1] = { x: path[0][0], y: path[0][1] }
          marks[i] = { x: path[path.length - 1][0], y: path[path.length - 1][1] }
          for (let k = 1; k < path.length; k++) {
            segments.push({
              ax: path[k - 1][0],
              ay: path[k - 1][1],
              bx: path[k][0],
              by: path[k][1],
              r: ROUTE_LINE_HALF_WIDTH_WORLD,
              color,
              kind: 'ride'
            })
          }
          continue
        }
        segments.push({
          ax: a.x,
          ay: a.y,
          bx: b.x,
          by: b.y,
          r: ROUTE_LINE_HALF_WIDTH_WORLD,
          color,
          kind: 'ride'
        })
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
        stops.push({ x: mark.x, y: mark.y, kind: 'stop', color })
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
    extend(pin.x, pin.y, pin.kind === 'stop' ? ROUTE_STOP_RADIUS_WORLD : ROUTE_PIN_RADIUS_WORLD)
  }

  return { overlay: { segments, pins }, bbox: { minX, minY, maxX, maxY } }
}
