import { describe, expect, it } from 'vitest'
import { loadGraph, Tsundere, weightsForWalking } from './index'
import { buildGraph, findRoute } from './router'

// The algorithm itself is covered in router.test.ts. This covers only what the
// handle adds: that loading produces a usable engine, and that going through it
// is indistinguishable from calling the free function.

const edge = (lineCode: string, from: string, to: string, distance = 1000) => ([
  { lineCode, fromStationId: from, toStationId: to, distance },
  { lineCode, fromStationId: to, toStationId: from, distance }
])

const edges = [
  ...edge('X', 'KCI-A', 'KCI-B'),
  ...edge('X', 'KCI-B', 'KCI-C'),
  ...edge('Y', 'MRTJ-P', 'MRTJ-Q')
]
const transfers = [{ fromStationId: 'KCI-C', toStationId: 'MRTJ-P', distance: 300 }]

describe('loadGraph', () => {
  it('returns an engine over the loaded network', () => {
    const tsun = loadGraph({ edges, transfers })
    expect(tsun).toBeInstanceOf(Tsundere)
    // A, B, C, P, Q — every node with at least one outgoing arc.
    expect(tsun.stopCount).toBe(5)
  })

  it('routes across the network it was loaded with', () => {
    const tsun = loadGraph({ edges, transfers })
    const legs = tsun.findRoute('KCI-A', 'MRTJ-Q')

    expect(legs).not.toBeNull()
    expect(legs!.map(leg => leg.type)).toEqual(['RIDE', 'TRANSFER', 'RIDE'])
  })

  it('returns null for an unreachable pair, like the free function', () => {
    const tsun = loadGraph({ edges: edge('X', 'KCI-A', 'KCI-B'), transfers: [] })
    expect(tsun.findRoute('KCI-A', 'KCI-ZZZ')).toBeNull()
  })

  /*
   * The load-bearing one. The handle must be a pure convenience over the same
   * algorithm — if it ever diverges, the golden-route diff that guards the
   * extraction stops meaning anything, because the API would be exercising a
   * different code path than the oracle.
   */
  it('produces identical output to calling findRoute directly', () => {
    const tsun = loadGraph({ edges, transfers })
    const graph = buildGraph(edges, transfers)

    for (const [from, to] of [['KCI-A', 'MRTJ-Q'], ['MRTJ-Q', 'KCI-A'], ['KCI-A', 'KCI-C']]) {
      expect(tsun.findRoute(from!, to!)).toEqual(findRoute(graph, from!, to!))
    }
  })

  it('carries endpoint restrictions from load time into every query', () => {
    const restricted = loadGraph({
      edges,
      transfers,
      restrictions: [{ stationId: 'KCI-A', forbiddenNeighborId: 'KCI-B' }]
    })
    // The restriction is symmetric: no boarding at A heading toward B, and no
    // alighting at A having arrived from B. Here B is A's only neighbour, so
    // both directions are blocked — that is the restriction working, not the
    // handle dropping it.
    expect(restricted.findRoute('KCI-A', 'KCI-C')).toBeNull()
    expect(restricted.findRoute('KCI-C', 'KCI-A')).toBeNull()
    // A pair that never touches the restricted stop is unaffected.
    expect(restricted.findRoute('KCI-B', 'KCI-C')).not.toBeNull()
  })
})

describe('findRoutes', () => {
  it('returns several journeys where alternatives exist', () => {
    const tsun = loadGraph({ edges, transfers })
    const journeys = tsun.findRoutes('KCI-A', 'MRTJ-Q')
    expect(journeys.length).toBeGreaterThan(0)
    expect(journeys[0]!.criteria.boardings).toBeGreaterThan(0)
  })

  it('agrees with findRoute on the primary route', () => {
    const tsun = loadGraph({ edges, transfers })
    expect(tsun.findRoutes('KCI-A', 'MRTJ-Q')[0]!.legs).toEqual(tsun.findRoute('KCI-A', 'MRTJ-Q'))
  })

  it('returns nothing for an unroutable pair, like findRoute', () => {
    const tsun = loadGraph({ edges, transfers })
    expect(tsun.findRoutes('KCI-A', 'KCI-NOPE')).toEqual([])
    expect(tsun.findRoute('KCI-A', 'KCI-NOPE')).toBeNull()
  })

  // Headways belong to the loaded network, so a query does not have to supply
  // them — but a per-call override still wins.
  it('uses headways supplied at load time', () => {
    const tsun = loadGraph({ edges, transfers, headwaysS: new Map([['X', 600]]) })
    expect(tsun.findRoutes('KCI-A', 'KCI-C')[0]!.criteria.waitS).toBe(300)
  })

  it('lets a per-call option override the loaded headways', () => {
    const tsun = loadGraph({ edges, transfers, headwaysS: new Map([['X', 600]]) })
    const journeys = tsun.findRoutes('KCI-A', 'KCI-C', { headwaysS: new Map([['X', 1200]]) })
    expect(journeys[0]!.criteria.waitS).toBe(600)
  })

  it('honours a walking preference', () => {
    const tsun = loadGraph({ edges, transfers })
    // Both preferences must still FIND the journey; only the order may differ.
    expect(tsun.findRoutes('KCI-A', 'MRTJ-Q', { weights: weightsForWalking('AVOID') }).length)
      .toBeGreaterThan(0)
  })
})
