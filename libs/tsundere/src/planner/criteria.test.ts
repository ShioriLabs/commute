import { describe, expect, it } from 'vitest'
import { DEFAULT_RANK_WEIGHTS, dominates, rankScore, weightsForWalking, type Criteria } from './criteria'

const criteria = (over: Partial<Criteria> = {}): Criteria => ({
  boardings: 1,
  rideDistanceM: 5000,
  walkDistanceM: 200,
  waitS: 300,
  fare: 3500,
  ...over
})

describe('dominates', () => {
  it('is false for a journey identical to another', () => {
    // Equal on everything means nothing is strictly better, so neither wins.
    expect(dominates(criteria(), criteria())).toBe(false)
  })

  it('is true when better on one axis and no worse on the rest', () => {
    const better = criteria({ boardings: 0 })
    expect(dominates(better, criteria())).toBe(true)
    expect(dominates(criteria(), better)).toBe(false)
  })

  it('is false when a journey trades one axis against another', () => {
    // Fewer boardings but much more walking: a real choice, not a worse route.
    // Both must survive or the engine has silently picked for the rider.
    const oneSeat = criteria({ boardings: 1, walkDistanceM: 900 })
    const shortWalk = criteria({ boardings: 2, walkDistanceM: 100 })
    expect(dominates(oneSeat, shortWalk)).toBe(false)
    expect(dominates(shortWalk, oneSeat)).toBe(false)
  })

  /*
   * The load-bearing one. Without bucketing, two journeys differing by a metre
   * are mutually non-dominated, nothing is ever discarded, and every bag grows
   * until the search dies. This is the assertion that proves the collapse.
   */
  it('treats a one-metre difference as equal, not as a distinct journey', () => {
    const a = criteria({ rideDistanceM: 5000 })
    const b = criteria({ rideDistanceM: 5001 })
    expect(dominates(a, b)).toBe(false)
    expect(dominates(b, a)).toBe(false)
  })

  it('still separates journeys a bucket apart', () => {
    const near = criteria({ rideDistanceM: 5000 })
    const far = criteria({ rideDistanceM: 5200 })
    expect(dominates(near, far)).toBe(true)
  })

  /*
   * Bucketing has a boundary wherever you put it: 5049 and 5051 round to 50 and
   * 51, so they do separate. That is inherent to quantising, not a bug — the
   * point is only that *small* differences collapse, which the metre test above
   * pins. Recorded here so nobody later "fixes" the boundary and reintroduces
   * unbounded bags.
   */
  it('separates values that straddle a bucket boundary', () => {
    expect(dominates(criteria({ rideDistanceM: 5049 }), criteria({ rideDistanceM: 5051 }))).toBe(true)
  })

  it('buckets waiting by the minute', () => {
    expect(dominates(criteria({ waitS: 300 }), criteria({ waitS: 320 }))).toBe(false)
    expect(dominates(criteria({ waitS: 300 }), criteria({ waitS: 420 }))).toBe(true)
  })

  describe('unknown fares', () => {
    /*
     * A null fare means "cannot be compared on this axis" — not free, not
     * infinite. Treating it as 0 would let an unpriceable journey dominate a
     * priced one it is otherwise equal to; treating it as Infinity would delete
     * it. Either way a rider loses a real option to a modelling artifact.
     */
    it('ignores the fare axis when either side is unknown', () => {
      const unpriced = criteria({ fare: null })
      const priced = criteria({ fare: 10000 })
      // Equal on all four known axes, so neither dominates.
      expect(dominates(unpriced, priced)).toBe(false)
      expect(dominates(priced, unpriced)).toBe(false)
    })

    it('still compares the other axes when a fare is unknown', () => {
      const cheapLooking = criteria({ fare: null, boardings: 0 })
      expect(dominates(cheapLooking, criteria({ fare: 10000 }))).toBe(true)
    })

    it('compares fares when both are known', () => {
      expect(dominates(criteria({ fare: 3500 }), criteria({ fare: 10000 }))).toBe(true)
    })
  })
})

describe('rankScore', () => {
  it('prefers fewer boardings when everything else matches', () => {
    expect(rankScore(criteria({ boardings: 1 }))).toBeLessThan(rankScore(criteria({ boardings: 2 })))
  })

  it('charges walking more per metre than riding', () => {
    const walked = criteria({ rideDistanceM: 0, walkDistanceM: 1000 })
    const ridden = criteria({ rideDistanceM: 1000, walkDistanceM: 0 })
    expect(rankScore(walked)).toBeGreaterThan(rankScore(ridden))
  })

  it('treats an unknown fare as zero rather than throwing', () => {
    // Fare weight is 0 by default, so this is really asserting the null-guard.
    expect(() => rankScore(criteria({ fare: null }))).not.toThrow()
  })

  it('honours caller-supplied weights', () => {
    const walkHater = { ...DEFAULT_RANK_WEIGHTS, walkDistanceM: 100 }
    const base = criteria({ walkDistanceM: 500 })
    expect(rankScore(base, walkHater)).toBeGreaterThan(rankScore(base))
  })
})

describe('walking preference', () => {
  const longWalk = criteria({ boardings: 1, walkDistanceM: 800, rideDistanceM: 4000 })
  const extraBoarding = criteria({ boardings: 2, walkDistanceM: 100, rideDistanceM: 4500 })

  it('defaults to the same weights as AVERAGE', () => {
    expect(weightsForWalking('AVERAGE')).toEqual(DEFAULT_RANK_WEIGHTS)
  })

  /*
   * The behaviour that makes this worth having: the same two journeys swap
   * places purely on the rider's tolerance for walking. Neither dominates the
   * other, so both are always found — the preference only decides which leads.
   */
  it('flips which journey ranks first as walking gets less welcome', () => {
    const brisk = weightsForWalking('BRISK')
    expect(rankScore(longWalk, brisk)).toBeLessThan(rankScore(extraBoarding, brisk))

    const slow = weightsForWalking('SLOW')
    expect(rankScore(longWalk, slow)).toBeGreaterThan(rankScore(extraBoarding, slow))
  })

  it('charges more for walking at every step from BRISK to AVOID', () => {
    const scores = (['BRISK', 'AVERAGE', 'SLOW', 'AVOID'] as const)
      .map(p => rankScore(longWalk, weightsForWalking(p)))
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i]!).toBeGreaterThan(scores[i - 1]!)
    }
  })

  // AVOID must not be a ban. A route that can only be walked has to survive, or
  // the rider gets nothing instead of an option they merely dislike.
  it('leaves AVOID finite so a walk-only route is still rankable', () => {
    expect(Number.isFinite(rankScore(longWalk, weightsForWalking('AVOID')))).toBe(true)
  })

  it('leaves the other axes alone', () => {
    const slow = weightsForWalking('SLOW')
    expect(slow.rideDistanceM).toBe(DEFAULT_RANK_WEIGHTS.rideDistanceM)
    expect(slow.boardings).toBe(DEFAULT_RANK_WEIGHTS.boardings)
    expect(slow.waitS).toBe(DEFAULT_RANK_WEIGHTS.waitS)
  })
})
