import { describe, expect, it } from 'vitest'
import { buildGraph, findRoute } from 'utils/router'

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
})
