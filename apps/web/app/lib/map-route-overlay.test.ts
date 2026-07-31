import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FareResult, FareResultRideLeg, FareResultTransferLeg } from '@commute/schemas'
import type { Point } from './map-renderer'
import { ROUTE_PIN_RADIUS_WORLD } from './map-renderer'
import { buildRouteOverlayModel } from './map-route-overlay'

// The overlay model is where fare legs (station id sequences) meet points.json
// (schematic shapes). Missing ids are a NORMAL case — points.json only covers
// stations drawn on the FDTJ schematic, and TJ topology-only stops aren't — so
// the chording behavior is load-bearing, not defensive.

// A point whose centroid lands exactly at (x, y).
function pt(id: string, x: number, y: number, station?: string): Point {
  return { id, station, ax: x - 10, ay: y, bx: x + 10, by: y, r: 5 }
}

// A leg names its line by key; the colour resolves against /operators. The
// fixture keeps taking a colour so each test can still pin what gets drawn —
// it just travels through `resolveLine` now, as it does in the app.
const lineColors = new Map<string, string>()

function rideLeg(stopIds: string[], lineColor = '#FF0000'): FareResultRideLeg {
  const line = `KCI:L${lineColors.size}`
  lineColors.set(line, lineColor)
  return {
    type: 'RIDE',
    line,
    operator: 'KCI',
    from: { id: stopIds[0], name: stopIds[0] },
    to: { id: stopIds[stopIds.length - 1], name: stopIds[stopIds.length - 1] },
    stationCount: stopIds.length,
    stops: stopIds.map(id => ({ id, name: id })),
    headsign: null,
    distanceM: 1000
  }
}

const resolveLine = (key: string | undefined) => {
  const colorCode = key ? lineColors.get(key) : undefined
  return colorCode ? { colorCode } : undefined
}

function transferLeg(fromId: string, toId: string): FareResultTransferLeg {
  return {
    type: 'TRANSFER',
    from: { id: fromId, name: fromId },
    to: { id: toId, name: toId },
    distanceM: 100
  }
}

function fareResult(legs: FareResult['legs'], fromId: string, toId: string): FareResult {
  return {
    from: { id: fromId, name: fromId },
    to: { id: toId, name: toId },
    legs,
    segments: [],
    totalFare: 5000,
    totalDistanceM: 1000,
    transferCount: 0
  }
}

const pair = (fromId: string | null, toId: string | null) => ({ fromId, toId })

afterEach(() => {
  vi.restoreAllMocks()
})

describe('buildRouteOverlayModel', () => {
  it('returns null when nothing resolves against the points', () => {
    expect(buildRouteOverlayModel(null, pair('KCI-XXX', 'KCI-YYY'), [pt('KCI-AAA', 0, 0)], resolveLine)).toBeNull()
  })

  it('builds a pins-only overlay from the pair while fare is unresolved', () => {
    const points = [pt('KCI-AAA', 100, 200), pt('KCI-BBB', 300, 400)]
    const model = buildRouteOverlayModel(null, pair('KCI-AAA', 'KCI-BBB'), points, resolveLine)
    expect(model).not.toBeNull()
    expect(model!.overlay.segments).toEqual([])
    expect(model!.overlay.pins).toEqual([
      { x: 100, y: 200, kind: 'origin' },
      { x: 300, y: 400, kind: 'destination' }
    ])
  })

  it('builds a single pin when only one endpoint is set', () => {
    const model = buildRouteOverlayModel(null, pair('KCI-AAA', null), [pt('KCI-AAA', 100, 200)], resolveLine)
    expect(model!.overlay.pins).toEqual([{ x: 100, y: 200, kind: 'origin' }])
    expect(model!.overlay.segments).toEqual([])
  })

  it('pads the bbox by the pin radius', () => {
    const model = buildRouteOverlayModel(null, pair('KCI-AAA', 'KCI-BBB'), [
      pt('KCI-AAA', 100, 200),
      pt('KCI-BBB', 300, 400)
    ], resolveLine)
    expect(model!.bbox).toEqual({
      minX: 100 - ROUTE_PIN_RADIUS_WORLD,
      minY: 200 - ROUTE_PIN_RADIUS_WORLD,
      maxX: 300 + ROUTE_PIN_RADIUS_WORLD,
      maxY: 400 + ROUTE_PIN_RADIUS_WORLD
    })
  })

  it('turns a ride leg into solid segments through stop centroids', () => {
    const points = [pt('KCI-AAA', 0, 0), pt('KCI-MID', 100, 0), pt('KCI-BBB', 200, 0)]
    const fare = fareResult([rideLeg(['KCI-AAA', 'KCI-MID', 'KCI-BBB'], '#FF0000')], 'KCI-AAA', 'KCI-BBB')
    const model = buildRouteOverlayModel(fare, pair('KCI-AAA', 'KCI-BBB'), points, resolveLine)
    const segments = model!.overlay.segments
    expect(segments).toHaveLength(2)
    expect(segments[0]).toMatchObject({ ax: 0, ay: 0, bx: 100, by: 0, kind: 'ride', color: [1, 0, 0] })
    expect(segments[1]).toMatchObject({ ax: 100, ay: 0, bx: 200, by: 0, kind: 'ride' })
  })

  it('chords across stops missing from points and warns once per build', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const points = [pt('KCI-AAA', 0, 0), pt('KCI-BBB', 200, 0)]
    const fare = fareResult(
      [rideLeg(['KCI-AAA', 'TJ-GONE1', 'TJ-GONE2', 'KCI-BBB'])],
      'KCI-AAA',
      'KCI-BBB'
    )
    const model = buildRouteOverlayModel(fare, pair('KCI-AAA', 'KCI-BBB'), points, resolveLine)
    expect(model!.overlay.segments).toHaveLength(1)
    expect(model!.overlay.segments[0]).toMatchObject({ ax: 0, ay: 0, bx: 200, by: 0 })
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0].join(' ')).toContain('TJ-GONE1')
    expect(warn.mock.calls[0].join(' ')).toContain('TJ-GONE2')
  })

  it('degrades to pins only when fewer than two polyline vertices resolve', () => {
    const points = [pt('KCI-AAA', 0, 0), pt('KCI-BBB', 200, 0)]
    // Version-skewed points: the whole ride path is unresolvable, but the pair
    // endpoints still are — the chip stays valid, the map shows pins.
    const fare = fareResult([rideLeg(['TJ-GONE1', 'TJ-GONE2'])], 'KCI-AAA', 'KCI-BBB')
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const model = buildRouteOverlayModel(fare, pair('KCI-AAA', 'KCI-BBB'), points, resolveLine)
    expect(model!.overlay.segments).toEqual([])
    expect(model!.overlay.pins).toHaveLength(2)
  })

  it('renders transfers as dashed sub-segments', () => {
    const points = [pt('KCI-AAA', 0, 0), pt('KCI-BBB', 100, 0), pt('MRT-CCC', 200, 0), pt('MRT-DDD', 300, 0)]
    const fare = fareResult(
      [
        rideLeg(['KCI-AAA', 'KCI-BBB']),
        transferLeg('KCI-BBB', 'MRT-CCC'),
        rideLeg(['MRT-CCC', 'MRT-DDD'], '#0000FF')
      ],
      'KCI-AAA',
      'MRT-DDD'
    )
    const model = buildRouteOverlayModel(fare, pair('KCI-AAA', 'MRT-DDD'), points, resolveLine)
    const transfers = model!.overlay.segments.filter(s => s.kind === 'transfer')
    expect(transfers.length).toBeGreaterThan(1) // 100 world units → several dashes
    expect(transfers[0].ax).toBeGreaterThanOrEqual(100)
    expect(transfers[transfers.length - 1].bx).toBeLessThanOrEqual(200)
    const rides = model!.overlay.segments.filter(s => s.kind === 'ride')
    expect(rides).toHaveLength(2)
  })

  it('bridges abutting ride legs whose endpoints resolve to different centroids', () => {
    const points = [pt('KCI-AAA', 0, 0), pt('KCI-BBB', 100, 0), pt('MRT-CCC', 200, 0), pt('MRT-DDD', 300, 0)]
    const fare = fareResult(
      [rideLeg(['KCI-AAA', 'KCI-BBB']), rideLeg(['MRT-CCC', 'MRT-DDD'])],
      'KCI-AAA',
      'MRT-DDD'
    )
    const model = buildRouteOverlayModel(fare, pair('KCI-AAA', 'MRT-DDD'), points, resolveLine)
    const transfers = model!.overlay.segments.filter(s => s.kind === 'transfer')
    expect(transfers.length).toBeGreaterThan(0)
    expect(transfers[0].ax).toBeGreaterThanOrEqual(100)
    expect(transfers[transfers.length - 1].bx).toBeLessThanOrEqual(200)
  })

  it('prefers an exact point id over a station alias', () => {
    // Flyover Jatinegara case: a decorative extra shape aliases the station via
    // `station`, while the primary shape owns the exact id. The pin must land
    // on the primary shape.
    const alias = pt('TJ-H00037C-b', 500, 500, 'TJ-H00037C')
    const exact = pt('TJ-H00037C', 100, 100)
    const model = buildRouteOverlayModel(null, pair('TJ-H00037C', null), [alias, exact], resolveLine)
    expect(model!.overlay.pins).toEqual([{ x: 100, y: 100, kind: 'origin' }])
  })
})
