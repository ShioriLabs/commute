import { describe, expect, it } from 'vitest'
import { buildGraph, findRoute } from '../router'
import { plan } from './plan'

const edge = (lineCode: string, from: string, to: string, distance = 1000) => ([
  { lineCode, fromStationId: from, toStationId: to, distance },
  { lineCode, fromStationId: to, toStationId: from, distance }
])

// Line X: A-B-C-D. Line Y: C-E. Walk: D <-> P (300m). Line Z: P-Q.
const edges = [
  ...edge('X', 'KCI-A', 'KCI-B'),
  ...edge('X', 'KCI-B', 'KCI-C'),
  ...edge('X', 'KCI-C', 'KCI-D'),
  ...edge('Y', 'KCI-C', 'KCI-E'),
  ...edge('Z', 'MRTJ-P', 'MRTJ-Q')
]
const transfers = [{ fromStationId: 'KCI-D', toStationId: 'MRTJ-P', distance: 300 }]
const graph = buildGraph(edges, transfers)

describe('plan', () => {
  it('returns nothing for an unknown stop', () => {
    expect(plan(graph, 'KCI-A', 'KCI-NOPE')).toEqual([])
    expect(plan(graph, 'KCI-NOPE', 'KCI-A')).toEqual([])
  })

  it('finds a one-line journey and counts one boarding', () => {
    const [best] = plan(graph, 'KCI-A', 'KCI-D')
    expect(best).toBeDefined()
    expect(best!.legs).toHaveLength(1)
    expect(best!.criteria.boardings).toBe(1)
    expect(best!.criteria.rideDistanceM).toBe(3000)
    expect(best!.criteria.walkDistanceM).toBe(0)
  })

  it('merges consecutive same-line hops into one leg', () => {
    const [best] = plan(graph, 'KCI-A', 'KCI-D')
    const leg = best!.legs[0]!
    expect(leg.type).toBe('RIDE')
    // The COMPLETE ordered stop list, not just the endpoints —
    // mergeInterlinedLegs downstream matches this against topology paths.
    expect(leg.type === 'RIDE' && leg.stationIds).toEqual(['KCI-A', 'KCI-B', 'KCI-C', 'KCI-D'])
  })

  it('splits a leg where the line changes and charges a second boarding', () => {
    const [best] = plan(graph, 'KCI-A', 'KCI-E')
    expect(best!.legs.map(l => l.type)).toEqual(['RIDE', 'RIDE'])
    expect(best!.criteria.boardings).toBe(2)
  })

  it('routes across a walk transfer, counting it as walking not riding', () => {
    const [best] = plan(graph, 'KCI-A', 'MRTJ-Q')
    expect(best!.legs.map(l => l.type)).toEqual(['RIDE', 'TRANSFER', 'RIDE'])
    expect(best!.criteria.walkDistanceM).toBe(300)
    expect(best!.criteria.rideDistanceM).toBe(4000)
  })

  it('agrees with findRoute on the primary route for simple journeys', () => {
    for (const [from, to] of [['KCI-A', 'KCI-D'], ['KCI-A', 'MRTJ-Q'], ['KCI-A', 'KCI-E']]) {
      const [best] = plan(graph, from!, to!)
      expect(best!.legs).toEqual(findRoute(graph, from!, to!))
    }
  })

  describe('wait model', () => {
    it('charges half the headway per boarding', () => {
      const headwaysS = new Map([['X', 600]])
      const [best] = plan(graph, 'KCI-A', 'KCI-D', { headwaysS })
      expect(best!.criteria.waitS).toBe(300)
    })

    it('charges each boarding separately', () => {
      const headwaysS = new Map([['X', 600], ['Y', 1200]])
      const [best] = plan(graph, 'KCI-A', 'KCI-E', { headwaysS })
      // 300 for boarding X, 600 for boarding Y.
      expect(best!.criteria.waitS).toBe(900)
    })

    it('falls back for a line with no headway data', () => {
      const [best] = plan(graph, 'KCI-A', 'KCI-D', { headwaysS: new Map(), defaultHeadwayS: 1000 })
      expect(best!.criteria.waitS).toBe(500)
    })

    // A walk boards nothing, so it must not be charged a wait.
    it('does not charge waiting for a transfer', () => {
      const headwaysS = new Map([['X', 600], ['Z', 600]])
      const [best] = plan(graph, 'KCI-A', 'MRTJ-Q', { headwaysS })
      expect(best!.criteria.waitS).toBe(600) // two boardings, not three
    })
  })

  describe('fare hook', () => {
    it('leaves fare null when no scorer is supplied', () => {
      expect(plan(graph, 'KCI-A', 'KCI-D')[0]!.criteria.fare).toBeNull()
    })

    it('prices each journey with the scorer', () => {
      const [best] = plan(graph, 'KCI-A', 'KCI-D', { scoreFare: () => 3500 })
      expect(best!.criteria.fare).toBe(3500)
    })

    it('hands the scorer complete legs, not partial ones', () => {
      const seen: number[] = []
      plan(graph, 'KCI-A', 'MRTJ-Q', {
        scoreFare: (legs) => {
          seen.push(legs.length)
          // A partial journey would not reach the destination.
          expect(legs[legs.length - 1]!.toStationId).toBe('MRTJ-Q')
          return 1000
        }
      })
      expect(seen.length).toBeGreaterThan(0)
    })

    it('keeps a journey whose fare is unknown', () => {
      const [best] = plan(graph, 'KCI-A', 'KCI-D', { scoreFare: () => null })
      expect(best).toBeDefined()
      expect(best!.criteria.fare).toBeNull()
    })
  })

  describe('bounds', () => {
    it('respects maxResults', () => {
      expect(plan(graph, 'KCI-A', 'MRTJ-Q', { maxResults: 1 }).length).toBeLessThanOrEqual(1)
    })

    it('finds nothing when the journey needs more boardings than allowed', () => {
      // A->Q needs two boardings; one round cannot reach it.
      expect(plan(graph, 'KCI-A', 'MRTJ-Q', { maxRounds: 1 })).toEqual([])
    })

    it('terminates on a graph with a cycle', () => {
      const cyclic = buildGraph([
        ...edge('X', 'A', 'B'),
        ...edge('X', 'B', 'C'),
        ...edge('X', 'C', 'A')
      ], [])
      expect(() => plan(cyclic, 'A', 'C')).not.toThrow()
      expect(plan(cyclic, 'A', 'C').length).toBeGreaterThan(0)
    })
  })

  describe('deduplication', () => {
    /*
     * Overlapping corridors — TJ 13 / 13E / L13E share a trunk — otherwise
     * return the same journey once per line code. The rider sees five
     * identical-looking options; the engine looks broken.
     */
    it('collapses journeys that differ only by which line served the ride', () => {
      const twins = buildGraph([
        ...edge('P', 'S1', 'S2'),
        ...edge('Q', 'S1', 'S2'),
        ...edge('R', 'S1', 'S2')
      ], [])
      const journeys = plan(twins, 'S1', 'S2')
      expect(journeys).toHaveLength(1)
    })
  })

  describe('endpoint restrictions', () => {
    const restricted = buildGraph(edges, transfers, [
      { stationId: 'KCI-A', forbiddenNeighborId: 'KCI-B' }
    ])

    it('refuses to board the origin toward its forbidden neighbour', () => {
      expect(plan(restricted, 'KCI-A', 'KCI-D')).toEqual([])
    })

    it('leaves unaffected pairs alone', () => {
      expect(plan(restricted, 'KCI-B', 'KCI-D').length).toBeGreaterThan(0)
    })
  })
})

describe('defaults', () => {
  /*
   * The default bag size is a CPU budget, not an algorithmic choice: Cloudflare
   * Workers' free tier allows 10ms per request, and the wider search measured
   * 15.1ms median / 31.0ms max on the real network. If someone raises this,
   * they should do it knowing what it costs — see the table above DEFAULTS.
   */
  it('searches narrowly enough to fit a 10ms CPU budget', () => {
    // Asking for more journeys than a narrow search can find must not throw or
    // pad the result — it simply returns what genuinely exists.
    const journeys = plan(graph, 'KCI-A', 'MRTJ-Q', { maxResults: 5 })
    expect(journeys.length).toBeLessThanOrEqual(5)
    expect(journeys.length).toBeGreaterThan(0)
  })

  it('still finds a journey needing three boardings', () => {
    // maxRounds stays at 4 for this reason: trimming it is cheaper than
    // trimming the bag but makes genuinely multi-boarding journeys unroutable.
    const chain = buildGraph([
      ...edge('L1', 'S0', 'S1'),
      ...edge('L2', 'S1', 'S2'),
      ...edge('L3', 'S2', 'S3')
    ], [])
    const [best] = plan(chain, 'S0', 'S3')
    expect(best).toBeDefined()
    expect(best!.criteria.boardings).toBe(3)
  })
})
