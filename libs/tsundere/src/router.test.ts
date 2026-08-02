import { describe, expect, it } from 'vitest'
import { buildGraph, findRoute } from './router'

// Line X: A-B-C-D (1000m hops). Line Y: C-E (1000m). Transfer: D <-> P (300m).
// Line Z (other operator): P-Q (1000m).
const edge = (lineCode: string, from: string, to: string, distance = 1000) => ([
  { lineCode, fromStationId: from, toStationId: to, distance },
  { lineCode, fromStationId: to, toStationId: from, distance }
])
const edges = [
  ...edge('X', 'KCI-A', 'KCI-B'), ...edge('X', 'KCI-B', 'KCI-C'), ...edge('X', 'KCI-C', 'KCI-D'),
  ...edge('Y', 'KCI-C', 'KCI-E'),
  ...edge('Z', 'MRTJ-P', 'MRTJ-Q')
]
const transfers = [{ fromStationId: 'KCI-D', toStationId: 'MRTJ-P', distance: 300 }]
const graph = buildGraph(edges, transfers)

describe('findRoute', () => {
  it('routes along one line and merges hops into a single leg', () => {
    const legs = findRoute(graph, 'KCI-A', 'KCI-D')!
    expect(legs).toHaveLength(1)
    expect(legs[0]).toMatchObject({ type: 'RIDE', lineCode: 'X', distanceM: 3000, stationIds: ['KCI-A', 'KCI-B', 'KCI-C', 'KCI-D'] })
  })

  it('splits legs on a line change at a shared station', () => {
    const legs = findRoute(graph, 'KCI-A', 'KCI-E')!
    expect(legs.map(l => l.type)).toEqual(['RIDE', 'RIDE'])
    expect((legs[1] as { lineCode: string }).lineCode).toBe('Y')
  })

  it('crosses operators through a transfer, walking distance reported not penalized', () => {
    const legs = findRoute(graph, 'KCI-A', 'MRTJ-Q')!
    expect(legs.map(l => l.type)).toEqual(['RIDE', 'TRANSFER', 'RIDE'])
    expect(legs[1]!.distanceM).toBe(300)
  })

  it('treats one-directional transfer rows as bidirectional', () => {
    expect(findRoute(graph, 'MRTJ-Q', 'KCI-A')).not.toBeNull()
  })

  it('returns null when unreachable', () => {
    expect(findRoute(graph, 'KCI-A', 'LRTJ-NOPE')).toBeNull()
  })

  it('derives operator from the station id prefix', () => {
    const legs = findRoute(graph, 'MRTJ-P', 'MRTJ-Q')!
    expect((legs[0] as { operator: string }).operator).toBe('MRTJ')
  })

  it('stays on one line when two overlapping lines share a trunk (continuity bias)', () => {
    // Lines P and Q both serve the exact same A-B-C-D trunk at equal distance —
    // the shape that made TJ 13/13E ping-pong. Without the mid-ride line-change
    // bias, Dijkstra could alternate P/Q hop by hop; with it, one line wins and
    // the whole ride is a single leg.
    const dup = [
      ...edge('P', 'TJ-A', 'TJ-B'), ...edge('P', 'TJ-B', 'TJ-C'), ...edge('P', 'TJ-C', 'TJ-D'),
      ...edge('Q', 'TJ-A', 'TJ-B'), ...edge('Q', 'TJ-B', 'TJ-C'), ...edge('Q', 'TJ-C', 'TJ-D')
    ]
    const legs = findRoute(buildGraph(dup, []), 'TJ-A', 'TJ-D')!
    expect(legs).toHaveLength(1)
    expect(legs[0]).toMatchObject({ type: 'RIDE', distanceM: 3000, stationIds: ['TJ-A', 'TJ-B', 'TJ-C', 'TJ-D'] })
  })

  it('prefers a one-seat ride plus a short walk over a shorter-on-paper multi-transfer path (Kuningan Madya shape)', () => {
    // One-seat-plus-walk option: ride line M for 2600m, walk 300m, ride line N for
    // 6800m. Total 9700m real distance, one line change (the walk resets it, so
    // boarding N afterward is penalty-free).
    const oneSeatPlusWalk = [
      ...edge('M', 'TJ-ORIGIN', 'TJ-M1', 800), ...edge('M', 'TJ-M1', 'TJ-M2', 900), ...edge('M', 'TJ-M2', 'TJ-WALKA', 900),
      ...edge('N', 'TJ-WALKB', 'TJ-DEST', 6800)
    ]
    const walkTransfer = [{ fromStationId: 'TJ-WALKA', toStationId: 'TJ-WALKB', distance: 300 }]
    // Multi-transfer option: five separate lines, shorter in raw meters (8950m)
    // but four mid-ride line changes — real-world worse despite the shorter tape
    // measure, same shape as Kuningan Madya -> Tanjung Duren Arah Barat.
    const multiTransfer = [
      ...edge('P', 'TJ-ORIGIN', 'TJ-P1', 1800),
      ...edge('Q', 'TJ-P1', 'TJ-Q1', 1900),
      ...edge('R', 'TJ-Q1', 'TJ-R1', 1900),
      ...edge('S', 'TJ-R1', 'TJ-S1', 1750),
      ...edge('U', 'TJ-S1', 'TJ-DEST', 1600)
    ]
    const graph = buildGraph([...oneSeatPlusWalk, ...multiTransfer], walkTransfer)
    const legs = findRoute(graph, 'TJ-ORIGIN', 'TJ-DEST')!
    expect(legs.map(l => l.type)).toEqual(['RIDE', 'TRANSFER', 'RIDE'])
    expect((legs[0] as { lineCode: string }).lineCode).toBe('M')
    expect((legs[2] as { lineCode: string }).lineCode).toBe('N')
  })
})

describe('findRoute — noTap transfers', () => {
  it('carries noTap through onto the TRANSFER leg when the transfer row is marked noTap', () => {
    const noTapTransfers = [{ fromStationId: 'KCI-D', toStationId: 'MRTJ-P', distance: 300, noTap: 1 }]
    const noTapGraph = buildGraph(edges, noTapTransfers)
    const legs = findRoute(noTapGraph, 'KCI-A', 'MRTJ-Q')!
    expect(legs[1]).toMatchObject({ type: 'TRANSFER', noTap: true })
  })

  it('defaults noTap to false for an ordinary transfer row', () => {
    const legs = findRoute(graph, 'KCI-A', 'MRTJ-Q')!
    expect(legs[1]).toMatchObject({ type: 'TRANSFER', noTap: false })
  })
})

// A single directed edge row (one travel direction only).
const oneWay = (lineCode: string, from: string, to: string, distance = 1000) =>
  ({ lineCode, fromStationId: from, toStationId: to, distance })

describe('findRoute — asymmetric corridors (directed ride edges)', () => {
  // TJ Koridor 1 shape in miniature. Forward (Blok M-bound): A→K→B→D, where K is
  // an outbound-only stop. Reverse (Kota-bound): D→B→S→A, where S is a
  // reverse-only stop. The two directions share A/B/D but each has a unique stop.
  const fwd = [oneWay('1', 'TJ-A', 'TJ-K'), oneWay('1', 'TJ-K', 'TJ-B'), oneWay('1', 'TJ-B', 'TJ-D')]
  const rev = [oneWay('1', 'TJ-D', 'TJ-B'), oneWay('1', 'TJ-B', 'TJ-S'), oneWay('1', 'TJ-S', 'TJ-A')]
  const asymGraph = buildGraph([...fwd, ...rev], [])

  it('routes the forward direction via the outbound-only stop, never the reverse-only one', () => {
    const legs = findRoute(asymGraph, 'TJ-A', 'TJ-D')!
    const stops = (legs[0] as { stationIds: string[] }).stationIds
    expect(stops).toContain('TJ-K')
    expect(stops).not.toContain('TJ-S')
  })

  it('routes the reverse direction via the reverse-only stop, never the outbound-only one', () => {
    const legs = findRoute(asymGraph, 'TJ-D', 'TJ-A')!
    const stops = (legs[0] as { stationIds: string[] }).stationIds
    expect(stops).toContain('TJ-S')
    expect(stops).not.toContain('TJ-K')
  })
})

describe('findRoute — endpoint direction restriction (KCI-PSE)', () => {
  // Loop fragment: GST — PSE — KMO — KPB, bidirectional track (both directions
  // exist, matching real edges). PSE serves KPB-bound only, so GST is PSE's
  // forbidden neighbor: no boarding at PSE toward GST, no alighting at PSE from GST.
  const loop = [
    ...edge('C', 'KCI-GST', 'KCI-PSE'), ...edge('C', 'KCI-PSE', 'KCI-KMO'),
    ...edge('C', 'KCI-KMO', 'KCI-KPB'), ...edge('C', 'KCI-KPB', 'KCI-AK')
  ]
  const restriction = { stationId: 'KCI-PSE', forbiddenNeighborId: 'KCI-GST' }
  const restricted = buildGraph(loop, [], [restriction])

  it('through-routes past PSE in both directions (restriction never blocks pass-through)', () => {
    expect(findRoute(restricted, 'KCI-GST', 'KCI-KPB')).not.toBeNull()
    expect(findRoute(restricted, 'KCI-KPB', 'KCI-GST')).not.toBeNull()
  })

  it('forbids boarding at PSE toward the forbidden neighbor (GST-bound)', () => {
    // The only way from PSE to GST is the single hop toward the forbidden
    // neighbor; with the restriction there is no legal route.
    expect(findRoute(restricted, 'KCI-PSE', 'KCI-GST')).toBeNull()
  })

  it('still allows boarding at PSE toward the served direction (KPB-bound)', () => {
    expect(findRoute(restricted, 'KCI-PSE', 'KCI-KPB')).not.toBeNull()
  })

  it('forbids alighting at PSE having arrived from the forbidden neighbor', () => {
    // GST→PSE is a single hop arriving from the forbidden neighbor.
    expect(findRoute(restricted, 'KCI-GST', 'KCI-PSE')).toBeNull()
  })

  it('still allows alighting at PSE from the served direction (from KMO/KPB)', () => {
    expect(findRoute(restricted, 'KCI-KPB', 'KCI-PSE')).not.toBeNull()
  })

  it('leaves routing unchanged when no restrictions are passed', () => {
    const open = buildGraph(loop, [])
    expect(findRoute(open, 'KCI-PSE', 'KCI-GST')).not.toBeNull()
    expect(findRoute(open, 'KCI-GST', 'KCI-PSE')).not.toBeNull()
  })
})
