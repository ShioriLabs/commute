import { describe, expect, it } from 'vitest'
import { buildGraph, type RouteLeg } from '../router'
import { Bag } from './bag'
import { dominates, rankScore, type Criteria } from './criteria'
import { plan } from './plan'

/*
 * Golden master for the planner's observable behaviour.
 *
 * These lock in what the engine does TODAY, bugs included. That is the point:
 * the optimisations they guard (precomputed dominance buckets, deferred label
 * allocation, a cursor worklist) are all meant to be pure speed changes, so any
 * difference in these numbers is a defect introduced by the refactor rather than
 * a decision anyone made.
 *
 * Deliberately coarse and value-based rather than a set of readable assertions —
 * criteria.test.ts, bag.test.ts and plan.test.ts already say what the engine
 * *should* do, and duplicating them here would only mean two files to update
 * when behaviour genuinely changes. What those cannot do is notice a change in
 * some combination nobody thought to write down, which is exactly the risk when
 * rewriting a hot path.
 *
 * If one of these fails after an intentional behaviour change, re-record it —
 * but only once the named tests in the other three files agree with the change.
 */

/*
 * Deterministic pseudo-random source. A fixed LCG rather than Math.random so
 * the corpus is identical on every run and on every machine; a golden master
 * over a moving sample would be worthless.
 */
function lcg(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 0x100000000
  }
}

/*
 * 240 criteria vectors spanning the ranges the real network produces: up to
 * four boardings, 60km of riding, 1.5km of walking, up to two transfers' worth
 * of concourse allowance, half an hour of waiting, and unpriced journeys at
 * roughly the rate an unknown-fare operator produces them.
 */
function corpus(): Criteria[] {
  const rnd = lcg(20260807)
  const out: Criteria[] = []
  for (let i = 0; i < 240; i++) {
    out.push({
      boardings: Math.floor(rnd() * 5),
      rideDistanceM: Math.floor(rnd() * 60000),
      walkDistanceM: Math.floor(rnd() * 1500),
      concourseWalkM: Math.floor(rnd() * 3) * 250,
      waitS: Math.floor(rnd() * 1800),
      fare: rnd() < 0.15 ? null : Math.floor(rnd() * 20000)
    })
  }
  return out
}

const SAMPLES = corpus()

describe('dominance, over the whole corpus', () => {
  /*
   * Every ordered pair — 57,600 comparisons. The count alone would pass under a
   * refactor that swapped which pairs dominate while keeping the total; the
   * checksum is position-sensitive, so it will not.
   */
  it('produces the same verdicts', () => {
    let trueCount = 0
    let checksum = 0
    for (let i = 0; i < SAMPLES.length; i++) {
      for (let j = 0; j < SAMPLES.length; j++) {
        if (dominates(SAMPLES[i]!, SAMPLES[j]!)) {
          trueCount++
          checksum = (Math.imul(checksum, 31) + Math.imul(i, 211) + j) >>> 0
        }
      }
    }
    expect({ trueCount, checksum }).toEqual({ trueCount: 2995, checksum: 911319407 })
  })

  /*
   * Genuine invariants rather than recorded values, so these stay meaningful
   * even if the engine's semantics are deliberately changed later.
   */
  it('never lets a journey dominate itself', () => {
    for (const c of SAMPLES) expect(dominates(c, c)).toBe(false)
  })

  it('never lets two journeys dominate each other', () => {
    for (let i = 0; i < SAMPLES.length; i++) {
      for (let j = i + 1; j < SAMPLES.length; j++) {
        const both = dominates(SAMPLES[i]!, SAMPLES[j]!) && dominates(SAMPLES[j]!, SAMPLES[i]!)
        expect(both).toBe(false)
      }
    }
  })

  it('scores the corpus identically', () => {
    const total = SAMPLES.reduce((sum, c) => sum + rankScore(c), 0)
    expect(Math.round(total)).toBe(10080311)
  })
})

describe('bag, fed the whole corpus', () => {
  /*
   * Insert order matters to a bag — eviction depends on what is already held —
   * so this exercises the compaction and eviction paths far harder than the
   * hand-written cases in bag.test.ts.
   */
  const fingerprint = (maxSize: number) => {
    const bag = new Bag<number>({ maxSize })
    let kept = 0
    SAMPLES.forEach((criteria, index) => {
      if (bag.insert({ criteria, incomingLine: `L${index % 3}`, trace: index })) kept++
    })
    return {
      kept,
      size: bag.size,
      traces: bag.labels().map(l => l.trace).join(',')
    }
  }

  /*
   * Re-recorded 2026-09-04, when dominance became state-aware: a label may only
   * be beaten by one that arrived on the same line. Fewer labels are rejected on
   * the way in, so more of them reach a full bag and lose their place to the size
   * cap instead — which is why `kept` FELL while `size` held.
   *
   * Re-recorded again the same day, when eviction gained a per-line floor: the
   * cap now spares a line's last label and takes the next-worst instead, so a
   * label that used to be evicted survives and `kept` rose 23 -> 24. The held
   * set is unchanged, which is the point — the floor changes WHICH label pays
   * for the cap, not how wide the bag is.
   *
   * The other two sizes did not move, and both are explicable. This corpus
   * cycles three lines, so at maxSize 1 every label is the only one on its line
   * and the floor has no protected-free victim to choose — it falls back to the
   * global worst, which is the old behaviour exactly. At maxSize 8 the cap
   * rarely binds on three lines, so there is little eviction to change.
   */
  it('keeps the same labels at maxSize 4', () => {
    expect(fingerprint(4)).toEqual({ kept: 24, size: 4, traces: '137,198,202,214' })
  })

  it('keeps the same labels at maxSize 1', () => {
    expect(fingerprint(1)).toEqual({ kept: 11, size: 1, traces: '202' })
  })

  it('keeps the same labels at maxSize 8', () => {
    expect(fingerprint(8)).toEqual({ kept: 42, size: 8, traces: '29,107,137,152,174,198,202,214' })
  })
})

/*
 * A network with genuine alternatives, unlike the line graph in plan.test.ts:
 * two roughly parallel routes from A to E, a third via a branch, and three walk
 * transfers including a noTap one — so bags actually fill, labels get evicted,
 * and more than one journey survives to be labelled.
 */
const edge = (lineCode: string, from: string, to: string, distance: number) => ([
  { lineCode, fromStationId: from, toStationId: to, distance },
  { lineCode, fromStationId: to, toStationId: from, distance }
])

const NETWORK = buildGraph(
  [
    ...edge('X', 'KCI-A', 'KCI-B', 1200),
    ...edge('X', 'KCI-B', 'KCI-C', 900),
    ...edge('X', 'KCI-C', 'KCI-D', 1100),
    ...edge('X', 'KCI-D', 'KCI-E', 1400),
    ...edge('Y', 'KCI-A', 'MRTJ-F', 1800),
    ...edge('Y', 'MRTJ-F', 'MRTJ-G', 2100),
    ...edge('Y', 'MRTJ-G', 'KCI-E', 1600),
    ...edge('Z', 'KCI-C', 'LRTJ-H', 800),
    ...edge('Z', 'LRTJ-H', 'KCI-E', 700),
    ...edge('W', 'MRTJ-F', 'LRTJ-H', 2400)
  ],
  [
    { fromStationId: 'KCI-B', toStationId: 'MRTJ-F', distance: 250 },
    { fromStationId: 'MRTJ-G', toStationId: 'LRTJ-H', distance: 180, noTap: 1 },
    { fromStationId: 'KCI-D', toStationId: 'LRTJ-H', distance: 420 }
  ]
)

const HEADWAYS = new Map([['X', 600], ['Y', 900], ['Z', 1500], ['W', 300]])

// Deterministic and leg-shaped, so the fare axis and the CHEAPEST label are
// genuinely exercised without dragging apps/api's tariff logic in here.
const scoreFare = (legs: readonly RouteLeg[]): number =>
  3000 + 1500 * legs.filter(l => l.type === 'RIDE').length
  + Math.round(legs.reduce((sum, l) => sum + l.distanceM, 0) / 100)

const describeJourneys = (from: string, to: string) =>
  plan(NETWORK, from, to, { headwaysS: HEADWAYS, scoreFare })
    .map(j => [
      j.legs.map(l => (l.type === 'RIDE' ? `R:${l.lineCode}:${l.stationIds.join('>')}` : `W:${l.fromStationId}>${l.toStationId}`)).join('|'),
      `b${j.criteria.boardings}`,
      `r${j.criteria.rideDistanceM}`,
      `w${j.criteria.walkDistanceM}`,
      `c${j.criteria.concourseWalkM}`,
      `t${Math.round(j.criteria.waitS)}`,
      `f${j.criteria.fare}`,
      j.labels.join('+') || '-'
    ].join(' '))

describe('planner output on a branching network', () => {
  it('returns the same journeys for A -> E', () => {
    expect(describeJourneys('KCI-A', 'KCI-E')).toEqual([
      'R:X:KCI-A>KCI-B>KCI-C>KCI-D>KCI-E b1 r4600 w0 c0 t300 f4546 FEWEST_CHANGES+SHORTEST_WAIT+CHEAPEST',
      'R:X:KCI-A>KCI-B>KCI-C|R:Z:KCI-C>LRTJ-H>KCI-E b2 r3600 w0 c0 t1050 f6036 -'
    ])
  })

  it('returns the same journeys for A -> G', () => {
    expect(describeJourneys('KCI-A', 'MRTJ-G')).toEqual([
      'R:X:KCI-A>KCI-B>KCI-C>KCI-D|W:KCI-D>LRTJ-H|W:LRTJ-H>MRTJ-G b1 r3200 w600 c350 t300 f4538 SHORTEST_WAIT+CHEAPEST',
      'R:Y:KCI-A>MRTJ-F>MRTJ-G b1 r3900 w0 c0 t450 f4539 LEAST_WALKING',
      'R:X:KCI-A>KCI-B>KCI-C|R:Z:KCI-C>LRTJ-H|W:LRTJ-H>MRTJ-G b2 r2900 w180 c100 t1050 f6031 -'
    ])
  })

  it('returns the same journeys for E -> A', () => {
    expect(describeJourneys('KCI-E', 'KCI-A')).toEqual([
      'R:X:KCI-E>KCI-D>KCI-C>KCI-B>KCI-A b1 r4600 w0 c0 t300 f4546 FEWEST_CHANGES+SHORTEST_WAIT+CHEAPEST',
      'R:Z:KCI-E>LRTJ-H>KCI-C|R:X:KCI-C>KCI-B>KCI-A b2 r3600 w0 c0 t1050 f6036 -'
    ])
  })

  it('returns the same journeys for F -> E', () => {
    expect(describeJourneys('MRTJ-F', 'KCI-E')).toEqual([
      'W:MRTJ-F>KCI-B|R:X:KCI-B>KCI-C>KCI-D>KCI-E b1 r3400 w250 c250 t300 f4537 SHORTEST_WAIT',
      'R:Y:MRTJ-F>MRTJ-G>KCI-E b1 r3700 w0 c0 t450 f4537 -',
      'R:W:MRTJ-F>LRTJ-H|R:Z:LRTJ-H>KCI-E b2 r3100 w0 c0 t900 f6031 -'
    ])
  })

  it('returns the same journeys across every ordered pair', () => {
    const stops = ['KCI-A', 'KCI-B', 'KCI-C', 'KCI-D', 'KCI-E', 'MRTJ-F', 'MRTJ-G', 'LRTJ-H']
    let journeys = 0
    let checksum = 0
    for (const from of stops) {
      for (const to of stops) {
        if (from === to) continue
        for (const line of describeJourneys(from, to)) {
          journeys++
          for (let i = 0; i < line.length; i++) {
            checksum = (Math.imul(checksum, 31) + line.charCodeAt(i)) >>> 0
          }
        }
      }
    }
    /*
     * Re-recorded 2026-09-04 alongside the bag fingerprints. Exactly one of the
     * 56 ordered pairs moved: LRTJ-H -> KCI-A traded a two-boarding alternative
     * for a genuine one-seat one (walk to MRTJ-G, ride Y through to KCI-A),
     * which the old cross-line dominance deleted by letting the label arriving
     * at MRTJ-F on W beat the one arriving on Y. FEWEST_CHANGES correctly comes
     * off the primary there — with two one-boarding journeys, nothing wins it.
     *
     * Re-recorded 2026-09-05 when maxBagSize moved 4 -> 8. Four more journeys
     * across the 56 pairs, which is the change working rather than a defect: a
     * wider bag keeps states the cap was evicting, and this fixture's three
     * parallel routes plus a branch are exactly the shape that produces them.
     * On the real network the same change takes 2.407 journeys/OD to 2.993,
     * with 141 of 300 pairs gaining and 3 losing.
     */
    expect({ journeys, checksum }).toEqual({ journeys: 126, checksum: 3821255438 })
  })
})
