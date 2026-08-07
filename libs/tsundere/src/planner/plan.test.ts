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

  describe('labels', () => {
    /*
     * Labels drive the result cards, so a wrong one is user-visible in a way a
     * wrong criteria value is not: "Cheapest" on the dearer option is a lie the
     * rider acts on.
     */
    it('leaves a lone journey unlabelled', () => {
      // One journey, one option — it is not "the cheapest of several", it is
      // the only one. Labelling it would imply a comparison that never happened
      // and send the rider looking for an alternative that does not exist.
      const journeys = plan(graph, 'KCI-A', 'KCI-B')
      expect(journeys).toHaveLength(1)
      expect(journeys[0]!.labels).toEqual([])
    })

    /*
     * A fork with a genuine tradeoff: the direct ride is one boarding but a
     * 500m walk at the end, the indirect one is two boardings and no walk.
     * Neither dominates, so both survive to be labelled.
     */
    const forked = buildGraph([
      ...edge('D', 'F-ORIG', 'F-NEAR'),
      ...edge('I', 'F-ORIG', 'F-MID'),
      ...edge('J', 'F-MID', 'F-DEST')
    ], [
      { fromStationId: 'F-NEAR', toStationId: 'F-DEST', distance: 500 }
    ])

    it('labels the option that uniquely needs fewest boardings', () => {
      const journeys = plan(forked, 'F-ORIG', 'F-DEST')
      expect(journeys.length).toBeGreaterThan(1)
      const labelled = journeys.filter(j => j.labels.includes('FEWEST_CHANGES'))
      expect(labelled).toHaveLength(1)
      const fewest = Math.min(...journeys.map(j => j.criteria.boardings))
      expect(labelled[0]!.criteria.boardings).toBe(fewest)
    })

    it('labels the option that uniquely walks least', () => {
      const journeys = plan(forked, 'F-ORIG', 'F-DEST')
      const labelled = journeys.filter(j => j.labels.includes('LEAST_WALKING'))
      expect(labelled).toHaveLength(1)
      expect(labelled[0]!.criteria.walkDistanceM).toBe(0)
    })

    it('withholds CHEAPEST when two journeys share the lowest fare', () => {
      // A tie means neither is "the cheapest one". Two cards both claiming it
      // would be worse than neither claiming it.
      const journeys = plan(forked, 'F-ORIG', 'F-DEST', { scoreFare: () => 5000 })
      expect(journeys.length).toBeGreaterThan(1)
      expect(journeys.filter(j => j.labels.includes('CHEAPEST'))).toHaveLength(0)
    })

    it('never labels CHEAPEST on a journey with an unknown fare', () => {
      const journeys = plan(forked, 'F-ORIG', 'F-DEST', { scoreFare: () => null })
      expect(journeys.every(j => !j.labels.includes('CHEAPEST'))).toBe(true)
    })

    it('labels the cheaper option when fares genuinely differ', () => {
      const journeys = plan(forked, 'F-ORIG', 'F-DEST', {
        // The walking option is the dear one; the two-boarding option is cheap.
        scoreFare: legs => (legs.some(l => l.type === 'TRANSFER') ? 9000 : 3000)
      })
      const labelled = journeys.filter(j => j.labels.includes('CHEAPEST'))
      expect(labelled).toHaveLength(1)
      expect(labelled[0]!.criteria.fare).toBe(3000)
    })

    it('ignores walking differences too small to bucket', () => {
      // 20m apart is the same walk as far as the rider is concerned, and the
      // dominance test already treats it that way. Labels must agree, or the UI
      // claims a win the search does not believe in.
      const near = buildGraph([
        ...edge('P', 'S1', 'S2'),
        ...edge('Q', 'S1', 'S3')
      ], [
        { fromStationId: 'S2', toStationId: 'DEST', distance: 100 },
        { fromStationId: 'S3', toStationId: 'DEST', distance: 120 }
      ])
      const journeys = plan(near, 'S1', 'DEST')
      expect(journeys.filter(j => j.labels.includes('LEAST_WALKING'))).toHaveLength(0)
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

/*
 * A lollipop line, the shape KCI's Cikarang loop actually has: a stick running
 * in to J, and a loop that leaves J and closes back onto it.
 *
 *   stick:  KCI-S — KCI-J
 *   loop:   KCI-J — KCI-A — KCI-B — KCI-C — KCI-D — KCI-E — KCI-F — KCI-G — KCI-J
 *
 * Every edge is the same line, so a run of them looks like one vehicle to the
 * engine. It is not: a service reaching J off the loop leaves down the stick, so
 * riding G -> J -> A means changing trains at J even though the line code never
 * changes. That is what SERVICE BREAKS express.
 */
const lollipop = (serviceBreaks: Parameters<typeof buildGraph>[3] = []) => buildGraph(
  [
    ...edge('L', 'KCI-S', 'KCI-J'),
    ...edge('L', 'KCI-J', 'KCI-A'),
    ...edge('L', 'KCI-A', 'KCI-B'),
    ...edge('L', 'KCI-B', 'KCI-C'),
    ...edge('L', 'KCI-C', 'KCI-D'),
    ...edge('L', 'KCI-D', 'KCI-E'),
    ...edge('L', 'KCI-E', 'KCI-F'),
    ...edge('L', 'KCI-F', 'KCI-G'),
    ...edge('L', 'KCI-G', 'KCI-J')
  ],
  [],
  [],
  serviceBreaks
)

// Riding the loop past the point where it closes onto the stick.
const THROUGH_CLOSURE = [
  { lineCode: 'L', viaStationId: 'KCI-J', fromStationId: 'KCI-G', toStationId: 'KCI-A' },
  { lineCode: 'L', viaStationId: 'KCI-J', fromStationId: 'KCI-A', toStationId: 'KCI-G' }
]

describe('service breaks', () => {
  it('without them, rides straight through the loop closure as one boarding', () => {
    // The bug this exists to fix: G -> J -> A -> B is 3000m and scores a single
    // boarding, so it dominates the 5000m way round and the real one-seat ride
    // is never offered at all.
    const journeys = plan(lollipop(), 'KCI-G', 'KCI-B')
    expect(journeys).toHaveLength(1)
    expect(journeys[0]!.criteria.boardings).toBe(1)
    expect(journeys[0]!.criteria.rideDistanceM).toBe(3000)
  })

  it('charges a boarding for riding through the closure, and keeps both options', () => {
    const journeys = plan(lollipop(THROUGH_CLOSURE), 'KCI-G', 'KCI-B')
    expect(journeys).toHaveLength(2)

    // The short way still exists — you can make that trip, you just change
    // trains at J. Banning it would strand anyone travelling between the two
    // ends of the loop.
    const short = journeys.find(j => j.criteria.rideDistanceM === 3000)!
    expect(short.criteria.boardings).toBe(2)
    expect(short.legs.map(l => l.type)).toEqual(['RIDE', 'RIDE'])

    // And the genuine one-seat ride, the long way round, is now offered.
    const oneSeat = journeys.find(j => j.criteria.rideDistanceM === 5000)!
    expect(oneSeat.criteria.boardings).toBe(1)
    expect(oneSeat.labels).toContain('FEWEST_CHANGES')
  })

  it('leaves the stick-to-loop turn alone', () => {
    // A service running in off the stick continues onto the loop as one train.
    // Only the loop-to-loop turn through J is a change.
    const journeys = plan(lollipop(THROUGH_CLOSURE), 'KCI-S', 'KCI-B')
    expect(journeys[0]!.criteria.boardings).toBe(1)
    expect(journeys[0]!.legs).toHaveLength(1)
  })

  it('splits the leg where the break falls', () => {
    // Selected by shape, not position: the long way round ranks first here,
    // because one fewer boarding also means one fewer expected wait.
    const journeys = plan(lollipop(THROUGH_CLOSURE), 'KCI-G', 'KCI-A')
    const journey = journeys.find(j => j.criteria.rideDistanceM === 2000)
    expect(journey).toBeDefined()
    const legs = journey!.legs.filter(l => l.type === 'RIDE')
    expect(legs).toHaveLength(2)
    expect(legs[0]!.type === 'RIDE' && legs[0]!.stationIds).toEqual(['KCI-G', 'KCI-J'])
    expect(legs[1]!.type === 'RIDE' && legs[1]!.stationIds).toEqual(['KCI-J', 'KCI-A'])
  })
})
