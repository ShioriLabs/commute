/*
 * The criteria a journey is judged on, and what it means for one journey to be
 * better than another.
 *
 * Five axes rather than the single weighted scalar `findRoute` minimises. That
 * is the whole point: "shortest" and "fewest changes" and "least walking" are
 * genuinely different questions, and collapsing them into one number picks an
 * answer on the rider's behalf.
 */
export interface Criteria {
  /** Vehicle boardings. Equals the round index, so it is free. */
  boardings: number
  /** In-vehicle metres. Real distance, never a routing weight. */
  rideDistanceM: number
  /** Footpath metres, including transfers between stops. */
  walkDistanceM: number
  /**
   * Expected wait, summed over boardings. Derived from headways, not from a
   * timetable — this engine does not know when the next bus is, only how often
   * one tends to come.
   */
  waitS: number
  /**
   * Journey fare, or null when unknown.
   *
   * Null is not zero and not infinity. It means "this axis cannot be compared
   * for this journey": zero would make an unpriceable journey spuriously
   * dominant, infinity would silently delete it. See `dominates`.
   */
  fare: number | null
}

/*
 * Comparison buckets.
 *
 * Without these the engine does not work. Five continuous axes means two
 * journeys differing by one metre of walking are mutually non-dominated, so
 * nothing is ever discarded and every bag grows until the search dies. Rounding
 * *for the comparison only* collapses that family into a single label while the
 * reported values stay exact.
 *
 * 100m is roughly a city block, and below a minute of waiting is not a
 * difference a rider can act on.
 */
const DISTANCE_BUCKET_M = 100
const WAIT_BUCKET_S = 60

const bucket = (value: number, size: number) => Math.round(value / size)

/**
 * Does `a` dominate `b`?
 *
 * True when `a` is at least as good on every axis and strictly better on at
 * least one. A dominated journey can be discarded: nothing about it is worth
 * showing a rider, because another journey beats it outright.
 *
 * Fare is skipped whenever either side is unknown, which makes the pair
 * incomparable on that axis rather than letting an unpriced journey win or lose
 * by default.
 */
export function dominates(a: Criteria, b: Criteria): boolean {
  /*
   * Written out axis by axis rather than looped over an array of pairs.
   *
   * This is the hottest function in the engine — a profile at bag size 8 put
   * 36.8% of samples here and another 19.3% in the garbage collector. The
   * readable version allocated five tuples plus an array on every call and then
   * destructured each one, which is millions of short-lived objects per query.
   * Same logic, same result, no allocation.
   *
   * Ordered cheapest-comparison-first: `boardings` is a bare integer and the
   * most discriminating axis, so it rejects most pairs before any bucketing
   * arithmetic runs.
   */
  let strictlyBetter = false

  if (a.boardings > b.boardings) return false
  if (a.boardings < b.boardings) strictlyBetter = true

  const aRide = bucket(a.rideDistanceM, DISTANCE_BUCKET_M)
  const bRide = bucket(b.rideDistanceM, DISTANCE_BUCKET_M)
  if (aRide > bRide) return false
  if (aRide < bRide) strictlyBetter = true

  const aWalk = bucket(a.walkDistanceM, DISTANCE_BUCKET_M)
  const bWalk = bucket(b.walkDistanceM, DISTANCE_BUCKET_M)
  if (aWalk > bWalk) return false
  if (aWalk < bWalk) strictlyBetter = true

  const aWait = bucket(a.waitS, WAIT_BUCKET_S)
  const bWait = bucket(b.waitS, WAIT_BUCKET_S)
  if (aWait > bWait) return false
  if (aWait < bWait) strictlyBetter = true

  // Skipped entirely when either fare is unknown, leaving the pair
  // incomparable on that axis rather than guessing.
  if (a.fare !== null && b.fare !== null) {
    if (a.fare > b.fare) return false
    if (a.fare < b.fare) strictlyBetter = true
  }

  return strictlyBetter
}

/*
 * Weights for collapsing the vector back into one number.
 *
 * Only ever used for *ordering* a result set and for deciding which label to
 * evict when a bag is full — never for pruning during the search, which is what
 * keeps the Pareto front honest.
 *
 * Metres are the base unit. Waiting is charged at roughly ten times riding per
 * second, since a bus covers ~10m in the second you spend waiting for it.
 * Walking is twice riding per metre. A boarding costs 600m, which lands in the
 * same range as the LINE_CHANGE_PENALTY_M the old router used for the same
 * instinct.
 */
export interface RankWeights {
  rideDistanceM: number
  walkDistanceM: number
  waitS: number
  boardings: number
  fare: number
}

export const DEFAULT_RANK_WEIGHTS: RankWeights = {
  rideDistanceM: 1,
  walkDistanceM: 2,
  waitS: 10,
  boardings: 600,
  fare: 0
}

/** Scalarised cost, for ranking and eviction only. */
export function rankScore(criteria: Criteria, weights: RankWeights = DEFAULT_RANK_WEIGHTS): number {
  return criteria.rideDistanceM * weights.rideDistanceM
    + criteria.walkDistanceM * weights.walkDistanceM
    + criteria.waitS * weights.waitS
    + criteria.boardings * weights.boardings
    + (criteria.fare ?? 0) * weights.fare
}

/*
 * How much a rider minds walking.
 *
 * This is a *preference*, not a speed. The engine has no duration model at all —
 * `edges.durationSeconds` exists in the schema but is null on all 1293 rows —
 * so it cannot tell anyone their journey takes eight minutes longer at their
 * pace. What it can do is shift which tradeoffs win: weight walking harder and
 * a 600m transfer stops beating an extra boarding.
 *
 * Expressed as named levels rather than a raw number because "how many times
 * worse than riding is a metre of walking" is not a question anyone can answer,
 * while "I walk slowly" is.
 */
export type WalkingPreference = 'BRISK' | 'AVERAGE' | 'SLOW' | 'AVOID'

/*
 * Multipliers on the walk axis, relative to riding.
 *
 * AVERAGE (2x) is the default and matches DEFAULT_RANK_WEIGHTS. AVOID is
 * deliberately steep rather than infinite: a hard ban would return nothing at
 * all when the only path involves a footbridge, and no route is worse than an
 * unwanted one. The dominance test is untouched — these only reorder the front
 * and decide bag eviction, so a short-walk option is still *found*, just
 * ranked lower.
 */
export const WALKING_WEIGHTS: Record<WalkingPreference, number> = {
  BRISK: 1,
  AVERAGE: 2,
  SLOW: 4,
  AVOID: 8
}

/** Rank weights adjusted for how much the rider minds walking. */
export function weightsForWalking(
  preference: WalkingPreference,
  base: RankWeights = DEFAULT_RANK_WEIGHTS
): RankWeights {
  return { ...base, walkDistanceM: WALKING_WEIGHTS[preference] }
}
