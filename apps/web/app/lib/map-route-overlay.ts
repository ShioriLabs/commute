import type { FareResult } from '@commute/schemas'
import { hexToRgb01 } from 'utils/colors'
import type { Point, RouteOverlay, RouteSegment } from './map-renderer'
import {
  dashSegment,
  pointStationId,
  ROUTE_LINE_HALF_WIDTH_WORLD,
  ROUTE_PIN_RADIUS_WORLD,
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
  resolveLine: (key: string | undefined) => { colorCode: string } | undefined
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

  const segments: RouteSegment[] = []
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
      if (cursor && (cursor.x !== vertices[0].x || cursor.y !== vertices[0].y)) {
        pushDashes(cursor, vertices[0])
      }
      const color = hexToRgb01(lineColor(leg.line))
      for (let i = 1; i < vertices.length; i++) {
        const a = vertices[i - 1]
        const b = vertices[i]
        if (a.x === b.x && a.y === b.y) continue
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
      cursor = vertices[vertices.length - 1]
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

  const pins: RouteOverlay['pins'] = []
  const origin = centroid(routePair.fromId)
  if (origin) pins.push({ x: origin.x, y: origin.y, kind: 'origin' })
  const destination = centroid(routePair.toId)
  if (destination) pins.push({ x: destination.x, y: destination.y, kind: 'destination' })

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
  for (const pin of pins) extend(pin.x, pin.y, ROUTE_PIN_RADIUS_WORLD)

  return { overlay: { segments, pins }, bbox: { minX, minY, maxX, maxY } }
}
