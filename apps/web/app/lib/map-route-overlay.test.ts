import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FareResult, FareResultRideLeg, FareResultTransferLeg } from '@commute/schemas'
import type { Point } from './map-renderer'
import { ROUTE_LINE_HALF_WIDTH_WORLD, ROUTE_PIN_RADIUS_WORLD, ROUTE_STOP_RADIUS_WORLD } from './map-renderer'
import type { Corridor } from './map-corridors'
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

  /*
   * The map draws whichever journey the rider selected, which on the beta
   * router is a FareJourney out of a TripResult rather than the whole response.
   * It carries no `from`/`to` — only `legs`, which is all this reads.
   */
  it('draws a selected journey, not only a whole fare response', () => {
    const points = [pt('KCI-AAA', 0, 0), pt('KCI-MID', 100, 0), pt('KCI-BBB', 200, 0)]
    const journey = { legs: [rideLeg(['KCI-AAA', 'KCI-MID', 'KCI-BBB'], '#FF0000')] }
    const model = buildRouteOverlayModel(journey, pair('KCI-AAA', 'KCI-BBB'), points, resolveLine)
    expect(model!.overlay.segments).toHaveLength(2)
  })

  /*
   * Selecting a different option must redraw, not merely re-price: two journeys
   * between one pair are two different corridors on the canvas.
   */
  it('draws different geometry for a different journey of the same pair', () => {
    const points = [pt('KCI-AAA', 0, 0), pt('KCI-MID', 100, 0), pt('KCI-BBB', 200, 0)]
    const viaMid = { legs: [rideLeg(['KCI-AAA', 'KCI-MID', 'KCI-BBB'], '#FF0000')] }
    const direct = { legs: [rideLeg(['KCI-AAA', 'KCI-BBB'], '#FF0000')] }
    const a = buildRouteOverlayModel(viaMid, pair('KCI-AAA', 'KCI-BBB'), points, resolveLine)
    const b = buildRouteOverlayModel(direct, pair('KCI-AAA', 'KCI-BBB'), points, resolveLine)
    expect(a!.overlay.segments).toHaveLength(2)
    expect(b!.overlay.segments).toHaveLength(1)
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

// Every station the route calls at gets a dot in the colour of the line being
// ridden through it, matching the schematic's own marker idiom.
describe('buildRouteOverlayModel stop dots', () => {
  it('marks each intermediate stop in the ridden line’s colour', () => {
    const points = [pt('KCI-AAA', 0, 0), pt('KCI-MID', 100, 0), pt('KCI-BBB', 200, 0)]
    const fare = fareResult([rideLeg(['KCI-AAA', 'KCI-MID', 'KCI-BBB'], '#FF0000')], 'KCI-AAA', 'KCI-BBB')
    const model = buildRouteOverlayModel(fare, pair('KCI-AAA', 'KCI-BBB'), points, resolveLine)
    const stops = model!.overlay.pins.filter(p => p.kind === 'stop')
    expect(stops).toEqual([{ x: 100, y: 0, kind: 'stop', color: [1, 0, 0], r: ROUTE_STOP_RADIUS_WORLD }])
  })

  it('leaves the journey’s own ends to their pins', () => {
    // A dot under an origin/destination pin is invisible geometry, and would
    // also colour an end by whichever line happens to touch it.
    const points = [pt('KCI-AAA', 0, 0), pt('KCI-BBB', 200, 0)]
    const fare = fareResult([rideLeg(['KCI-AAA', 'KCI-BBB'])], 'KCI-AAA', 'KCI-BBB')
    const model = buildRouteOverlayModel(fare, pair('KCI-AAA', 'KCI-BBB'), points, resolveLine)
    expect(model!.overlay.pins.filter(p => p.kind === 'stop')).toEqual([])
    expect(model!.overlay.pins.map(p => p.kind)).toEqual(['origin', 'destination'])
  })

  it('draws one dot at an interchange, not one per leg', () => {
    // Both legs call at the interchange; two stacked dots in different colours
    // would just be the second one winning.
    const points = [pt('KCI-AAA', 0, 0), pt('KCI-XCH', 100, 0), pt('MRT-BBB', 200, 0)]
    const fare = fareResult(
      [rideLeg(['KCI-AAA', 'KCI-XCH'], '#FF0000'), rideLeg(['KCI-XCH', 'MRT-BBB'], '#0000FF')],
      'KCI-AAA',
      'MRT-BBB'
    )
    const model = buildRouteOverlayModel(fare, pair('KCI-AAA', 'MRT-BBB'), points, resolveLine)
    const stops = model!.overlay.pins.filter(p => p.kind === 'stop')
    expect(stops).toHaveLength(1)
    // The arriving line owns it.
    expect(stops[0].color).toEqual([1, 0, 0])
  })

  it('pads the bbox by the dot radius, not the pin radius', () => {
    const points = [pt('KCI-AAA', 0, 0), pt('KCI-MID', 100, 500), pt('KCI-BBB', 200, 0)]
    const fare = fareResult([rideLeg(['KCI-AAA', 'KCI-MID', 'KCI-BBB'])], 'KCI-AAA', 'KCI-BBB')
    const model = buildRouteOverlayModel(fare, pair('KCI-AAA', 'KCI-BBB'), points, resolveLine)
    // The mid stop is the southmost thing drawn; its dot is smaller than a pin,
    // so over-padding here would widen the camera fit for every station between.
    expect(model!.bbox.maxY).toBe(500 + ROUTE_STOP_RADIUS_WORLD)
    expect(ROUTE_STOP_RADIUS_WORLD).toBeLessThan(ROUTE_PIN_RADIUS_WORLD)
  })
})

/*
 * Corridors make a ride leg follow the drawn line instead of chording between
 * stations. They are optional everywhere — the file is fetched separately, so
 * every one of these has a no-corridors counterpart above that must keep
 * working unchanged.
 */
/*
 * The confirmed wrong-line bug: a leg drawn along a NEIGHBOUR's stroke.
 *
 * Kalideres to Monumen Nasional rides Koridor 3, whose yellow is drawn with a
 * blue stub on the same alignment. Distance alone picked the blue for six of the
 * leg's pairs — including Jelambar->Grogol->Roxy from the original report —
 * because it sat a world unit nearer at those stops.
 */
describe('route overlay colour gate', () => {
  const YELLOW = '#F9C535'
  const BLUE = '#2455A3'
  // Two strokes on one alignment; the wrong-coloured one is marginally nearer.
  const yellowStroke: Corridor = { w: 15, c: YELLOW, pts: [[0, 0], [200, 0]] }
  const blueStub: Corridor = { w: 15, c: BLUE, pts: [[0, 8], [200, 8]] }

  const points: Point[] = [
    { id: 'TJ-A', ax: 0, ay: 6, bx: 0, by: 6, r: 12 },
    { id: 'TJ-B', ax: 200, ay: 6, bx: 200, by: 6, r: 12 }
  ]
  const fare = {
    legs: [{
      type: 'RIDE' as const,
      line: 'TJ:3',
      operator: 'TJ',
      stops: [{ id: 'TJ-A' }, { id: 'TJ-B' }]
    }]
  }
  // TJ:3's brand yellow: 25 channels from its artwork stroke, 217 from the blue.
  const resolveLine = () => ({ colorCode: '#FDCB1C' })

  it('rides its own stroke, not the nearer one of another colour', () => {
    const model = buildRouteOverlayModel(
      fare as never, { fromId: 'TJ-A', toId: 'TJ-B' }, points, resolveLine, [blueStub, yellowStroke]
    )
    const rides = model!.overlay.segments.filter(s => s.kind === 'ride')
    expect(rides.length).toBeGreaterThan(0)
    // The yellow stroke sits at y=0, the blue at y=8. Traced geometry follows
    // whichever it elected, so the drawn y says which one won.
    for (const segment of rides) expect(Math.abs(segment.ay)).toBeLessThan(4)
  })

  it('still draws when no stroke matches the line colour', () => {
    // A stretch drawn in a colour we cannot account for has to fall back to
    // colour-blind matching rather than vanishing from the route.
    const model = buildRouteOverlayModel(
      fare as never, { fromId: 'TJ-A', toId: 'TJ-B' }, points, resolveLine, [blueStub]
    )
    expect(model!.overlay.segments.filter(s => s.kind === 'ride').length).toBeGreaterThan(0)
  })
})

describe('buildRouteOverlayModel with corridors', () => {
  // An L: stations at the two ends, with the corner between them. A chord would
  // cut the diagonal; the corridor turns.
  const lCorridor: Corridor[] = [{ w: 25, c: '#00BDEE', pts: [[0, 0], [200, 0], [200, 200]] }]
  const endPoints = [pt('KCI-AAA', 0, 0), pt('KCI-BBB', 200, 200)]

  it('draws the same chords as before when no corridors are supplied', () => {
    const points = [pt('KCI-AAA', 0, 0), pt('KCI-MID', 100, 0), pt('KCI-BBB', 200, 0)]
    const fare = fareResult([rideLeg(['KCI-AAA', 'KCI-MID', 'KCI-BBB'])], 'KCI-AAA', 'KCI-BBB')
    const withUndefined = buildRouteOverlayModel(fare, pair('KCI-AAA', 'KCI-BBB'), points, resolveLine)
    const withEmpty = buildRouteOverlayModel(fare, pair('KCI-AAA', 'KCI-BBB'), points, resolveLine, [])
    expect(withEmpty!.overlay.segments).toEqual(withUndefined!.overlay.segments)
    expect(withEmpty!.overlay.segments).toHaveLength(2)
  })

  it('follows the corridor around a corner instead of chording across it', () => {
    const fare = fareResult([rideLeg(['KCI-AAA', 'KCI-BBB'], '#FF0000')], 'KCI-AAA', 'KCI-BBB')
    const model = buildRouteOverlayModel(fare, pair('KCI-AAA', 'KCI-BBB'), endPoints, resolveLine, lCorridor)
    const rides = model!.overlay.segments.filter(s => s.kind === 'ride')
    // Two segments, not one: the corner is now a vertex on the route.
    expect(rides).toHaveLength(2)
    expect(rides[0]).toMatchObject({ ax: 0, ay: 0, bx: 200, by: 0 })
    expect(rides[1]).toMatchObject({ ax: 200, ay: 0, bx: 200, by: 200 })
    // Every piece keeps the leg's own colour and width.
    for (const segment of rides) {
      expect(segment.color).toEqual([1, 0, 0])
      expect(segment.r).toBe(ROUTE_LINE_HALF_WIDTH_WORLD)
    }
  })

  it('grows the bbox to cover a corridor that bulges past the chord', () => {
    const fare = fareResult([rideLeg(['KCI-AAA', 'KCI-BBB'])], 'KCI-AAA', 'KCI-BBB')
    const chorded = buildRouteOverlayModel(fare, pair('KCI-AAA', 'KCI-BBB'), endPoints, resolveLine)
    const followed = buildRouteOverlayModel(fare, pair('KCI-AAA', 'KCI-BBB'), endPoints, resolveLine, lCorridor)
    // The corner at (200, 0) is outside the chord's own extent in y.
    expect(followed!.bbox.maxX).toBeGreaterThanOrEqual(chorded!.bbox.maxX)
    expect(followed!.bbox.minY).toBeLessThanOrEqual(chorded!.bbox.minY)
  })

  it('leaves transfers as straight dashes', () => {
    const points = [pt('KCI-AAA', 0, 0), pt('KCI-BBB', 100, 0), pt('MRT-CCC', 200, 0), pt('MRT-DDD', 300, 0)]
    const fare = fareResult(
      [rideLeg(['KCI-AAA', 'KCI-BBB']), transferLeg('KCI-BBB', 'MRT-CCC'), rideLeg(['MRT-CCC', 'MRT-DDD'])],
      'KCI-AAA',
      'MRT-DDD'
    )
    const corridors: Corridor[] = [{ w: 25, c: '#00BDEE', pts: [[0, 0], [300, 0]] }]
    const without = buildRouteOverlayModel(fare, pair('KCI-AAA', 'MRT-DDD'), points, resolveLine)
    const with_ = buildRouteOverlayModel(fare, pair('KCI-AAA', 'MRT-DDD'), points, resolveLine, corridors)
    expect(with_!.overlay.segments.filter(s => s.kind === 'transfer'))
      .toEqual(without!.overlay.segments.filter(s => s.kind === 'transfer'))
  })

  /*
   * Interchange bars: Manggarai's tap target is one 81-unit bar spanning three
   * parallel corridors ~40 units apart, so its centroid sits BETWEEN the lines
   * rather than on any of them. Markers placed at the raw centroid float off
   * the line the rider is actually on.
   */
  it('snaps markers onto the ridden corridor, not the interchange centroid', () => {
    // The station's centroid is 40 units off the corridor its route uses —
    // the real Manggarai offset.
    const bar = pt('KCI-XCH', 100, 40)
    const points = [pt('KCI-AAA', 0, 0), bar, pt('KCI-BBB', 200, 0)]
    const corridors: Corridor[] = [{ w: 25, c: '#00BDEE', pts: [[0, 0], [200, 0]] }]
    const fare = fareResult([rideLeg(['KCI-AAA', 'KCI-XCH', 'KCI-BBB'], '#FF0000')], 'KCI-AAA', 'KCI-BBB')
    const model = buildRouteOverlayModel(fare, pair('KCI-AAA', 'KCI-BBB'), points, resolveLine, corridors)
    const stops = model!.overlay.pins.filter(p => p.kind === 'stop')
    expect(stops).toHaveLength(1)
    // On the corridor (y = 0), not at the tap target's y = 40.
    expect(stops[0].y).toBe(0)
    expect(stops[0].x).toBeCloseTo(100, 0)
  })

  it('snaps the end pins too, so an arrow lands on its own line', () => {
    // Origin is the off-corridor bar this time: its pin must move onto the line.
    const points = [pt('KCI-XCH', 0, 40), pt('KCI-BBB', 200, 0)]
    const corridors: Corridor[] = [{ w: 25, c: '#00BDEE', pts: [[0, 0], [200, 0]] }]
    const fare = fareResult([rideLeg(['KCI-XCH', 'KCI-BBB'])], 'KCI-XCH', 'KCI-BBB')
    const model = buildRouteOverlayModel(fare, pair('KCI-XCH', 'KCI-BBB'), points, resolveLine, corridors)
    const origin = model!.overlay.pins.find(p => p.kind === 'origin')!
    expect(origin.y).toBe(0)
    // And it still picks up the ridden line's colour at its new position.
    expect(origin.color).toEqual([1, 0, 0])
  })

  /*
   * An interlined band: parallel strokes ~22 units apart with the tap targets
   * between them, on the artwork's straddling halte circles. The corridor
   * sub-paths here are straight, so they add nothing but a parallel offset —
   * the run must render as ONE straight line through its own markers, not ride
   * either stroke (Koridor 3 Kalideres→Roxy, the "where's the flat" report).
   */
  it('renders a straight interlined run as one line through the stops', () => {
    const corridors: Corridor[] = [
      { w: 15, c: '#00BDEE', pts: [[0, 0], [600, 0]] },
      { w: 15, c: '#00BDEE', pts: [[0, 22], [1000, 22]] }
    ]
    // Stops between the strokes, the second stroke a fraction nearer — and the
    // first stroke ending mid-run, which used to force a jog.
    const points = [pt('KCI-AAA', 100, 12), pt('KCI-BBB', 400, 12), pt('KCI-CCC', 700, 12), pt('KCI-DDD', 900, 12)]
    const fare = fareResult([rideLeg(['KCI-AAA', 'KCI-BBB', 'KCI-CCC', 'KCI-DDD'])], 'KCI-AAA', 'KCI-DDD')
    const model = buildRouteOverlayModel(fare, pair('KCI-AAA', 'KCI-DDD'), points, resolveLine, corridors)
    const rides = model!.overlay.segments.filter(s => s.kind === 'ride')
    // Dead flat ON the elected stroke (the second one serves all four stops),
    // no stroke-hopping, no jog — and every dot on that same line.
    for (const s of rides) {
      expect(s.ay).toBe(22)
      expect(s.by).toBe(22)
    }
    for (const p of model!.overlay.pins) expect(p.y).toBeCloseTo(22, 9)
  })

  /*
   * The ruler test: Koridor 3's western haltes sit ON its own stroke while the
   * interlined stretch straddles ~11 units off it, so per-pair chords kink
   * where the band begins. A nearly-collinear leg must come out as literally
   * ONE segment from first stop to last, every marker projected onto it.
   */
  it('draws a nearly-collinear leg as a single straight shot through its dots', () => {
    const corridors: Corridor[] = [
      { w: 15, c: '#00BDEE', pts: [[0, 12], [1400, 12]] }, // the leg's own stroke, ending mid-run
      { w: 15, c: '#00BDEE', pts: [[380, -10], [1900, -10]] } // the interlined neighbour carrying on
    ]
    // First three stops ON the first stroke, the rest 11 below it — the real
    // Kalideres→Roxy shape.
    const points = [
      pt('KCI-AAA', 0, 12), pt('KCI-BBB', 120, 12), pt('KCI-CCC', 250, 12),
      pt('KCI-DDD', 380, 1), pt('KCI-EEE', 900, 1), pt('KCI-FFF', 1600, 1), pt('KCI-GGG', 1835, 1)
    ]
    const fare = fareResult(
      [rideLeg(['KCI-AAA', 'KCI-BBB', 'KCI-CCC', 'KCI-DDD', 'KCI-EEE', 'KCI-FFF', 'KCI-GGG'])],
      'KCI-AAA',
      'KCI-GGG'
    )
    const model = buildRouteOverlayModel(fare, pair('KCI-AAA', 'KCI-GGG'), points, resolveLine, corridors)
    const rides = model!.overlay.segments.filter(s => s.kind === 'ride')
    // One segment, lying ON the elected stroke's line (y=12) and extended past
    // its drawn end to cover the last stops — not a line through the centroids,
    // which would slope between the levels.
    expect(rides).toHaveLength(1)
    expect(rides[0]).toMatchObject({ ax: 0, ay: 12, bx: 1835, by: 12 })
    // Every pin sits exactly on that line — "the dots put in the line itself".
    for (const p of model!.overlay.pins) expect(p.y).toBeCloseTo(12, 9)
  })

  /*
   * A leg can still legitimately change strokes where the offsets are REAL —
   * an interchange bar sitting ~25+ units off both corridors keeps the
   * corridor geometry (and its snap), and the two sub-paths share no endpoint.
   * The connector must make the leg ONE unbroken chain.
   */
  it('bridges the seam where a leg hands off between corridors', () => {
    const corridors: Corridor[] = [
      { w: 15, c: '#00BDEE', pts: [[0, 0], [400, 0]] },
      { w: 15, c: '#00BDEE', pts: [[400, 50], [800, 50]] }
    ]
    // The middle stop is a bar centroid 32 units off BOTH strokes — past the
    // band scale (25), so neither side may collapse to a chord.
    const points = [pt('KCI-AAA', 100, 0), pt('KCI-BAR', 400, 32), pt('KCI-BBB', 700, 64)]
    const fare = fareResult([rideLeg(['KCI-AAA', 'KCI-BAR', 'KCI-BBB'])], 'KCI-AAA', 'KCI-BBB')
    const model = buildRouteOverlayModel(fare, pair('KCI-AAA', 'KCI-BBB'), points, resolveLine, corridors)
    const rides = model!.overlay.segments.filter(s => s.kind === 'ride')
    // Emitted in travel order, every segment starts where the previous ended —
    // the seam between the strokes included.
    for (let i = 1; i < rides.length; i++) {
      expect({ x: rides[i].ax, y: rides[i].ay }).toEqual({ x: rides[i - 1].bx, y: rides[i - 1].by })
    }
    // And the bridge itself is there: a vertical jog across the 50-unit gap.
    expect(rides.some(s => s.ax === s.bx && s.ay !== s.by)).toBe(true)
  })

  it('chords the pairs that do not match and follows the ones that do', () => {
    // The corridor covers AAA→BBB only; BBB→CCC is nowhere near it.
    const points = [pt('KCI-AAA', 0, 0), pt('KCI-BBB', 200, 200), pt('KCI-CCC', 5000, 5000)]
    const fare = fareResult([rideLeg(['KCI-AAA', 'KCI-BBB', 'KCI-CCC'])], 'KCI-AAA', 'KCI-CCC')
    const model = buildRouteOverlayModel(fare, pair('KCI-AAA', 'KCI-CCC'), points, resolveLine, lCorridor)
    const rides = model!.overlay.segments.filter(s => s.kind === 'ride')
    // 2 from the followed corner + 1 chord for the unmatched pair.
    expect(rides).toHaveLength(3)
    expect(rides[2]).toMatchObject({ ax: 200, ay: 200, bx: 5000, by: 5000 })
  })
})
