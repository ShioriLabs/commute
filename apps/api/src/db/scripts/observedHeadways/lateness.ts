/*
 * Pure pieces of the arrive-by lateness backtest (docs/arrive-by.md, "Lateness
 * backtest"; driver in db/scripts/analyzeArriveByLateness.ts).
 *
 * The backtest asks: a rider reaches a TJ stop at t and needs to be at a later
 * stop of the same line-direction. Which real bus do they board, and when do
 * they get there? Ward gives per-trip stop passings; these helpers turn them
 * into that answer without touching files.
 */

/** One trip's passing times, ms, keyed by stop index along its direction. */
export type TripTimes = Map<number, number>

/** Every trip's passing at one stop, sorted by time. */
export type StopPassings = { t: number, at: TripTimes }[]

/** Holes longer than this stay holes: the bus is as likely to have left service as to have driven on. */
export const FILL_MAX_MS = 20 * 60_000

/**
 * Interpolate passings missing between two seen ones of the same trip, by stop
 * index. `extractPassings` drops observation gaps over 5 min, so without this a
 * quarter of the buses driving through a leg look like they never passed its
 * board or alight stop, and the replay makes the rider wait for the next one.
 *
 * Mutates `at`; returns how many passings it added.
 */
export function fillHoles(at: TripTimes, maxGapMs: number = FILL_MAX_MS): number {
  const seen = [...at.keys()].sort((a, b) => a - b)
  let added = 0
  for (let k = 1; k < seen.length; k++) {
    const a = seen[k - 1]!, b = seen[k]!
    const ta = at.get(a)!, tb = at.get(b)!
    if (b - a < 2 || tb - ta > maxGapMs) continue
    for (let x = a + 1; x < b; x++) {
      at.set(x, ta + (tb - ta) * (x - a) / (b - a))
      added++
    }
  }
  return added
}

export type ReplayResult =
  | { kind: 'rode', boardT: number, alightT: number, skipped: number }
  | { kind: 'inactive' }
  | { kind: 'noBus', skipped: number }

/**
 * The first bus passing the boarding stop at or after `t` that goes on to reach
 * stop `alight`. Buses that end before it (short-turns, or a trip that stops
 * reporting) are skipped, as a rider bound further would skip them.
 *
 * `inactive` when no bus passed the boarding stop in the `activeWithinMs` before
 * `t`: before the line starts, or tracking had died. Those moments say nothing
 * about waiting, so the caller drops them.
 */
export function replay(
  atBoard: StopPassings,
  t: number,
  alight: number,
  { maxWaitMs, activeWithinMs }: { maxWaitMs: number, activeWithinMs: number }
): ReplayResult {
  let lo = 0, hi = atBoard.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (atBoard[mid]!.t < t) lo = mid + 1
    else hi = mid
  }
  if (lo === 0 || t - atBoard[lo - 1]!.t > activeWithinMs) return { kind: 'inactive' }

  let skipped = 0
  for (let k = lo; k < atBoard.length && atBoard[k]!.t - t <= maxWaitMs; k++) {
    const bus = atBoard[k]!
    const alightT = bus.at.get(alight)
    if (alightT !== undefined && alightT > bus.t) return { kind: 'rode', boardT: bus.t, alightT, skipped }
    skipped++
  }
  return { kind: 'noBus', skipped }
}

/** Planner headway at or above which a single headway of wait is budgeted rather than 1.5. */
export const ARRIVE_BY_LONG_HEADWAY_S = 20 * 60

/**
 * The arrive-by budget for one TJ leg, decided 2026-11-24: 1.5 × headway of wait
 * on frequent lines, 1 × at 20 min and over, plus the p75 ride. Backtested at
 * ~7.5% late per leg. Long-headway lines run closer to their headway, so 1.5×
 * there leaves riders half an hour early for 2% late.
 */
export function arriveByBudgetS(headwayS: number, rideP75S: number): number {
  return (headwayS >= ARRIVE_BY_LONG_HEADWAY_S ? 1 : 1.5) * headwayS + rideP75S
}
