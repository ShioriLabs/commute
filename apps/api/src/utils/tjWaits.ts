import { OBSERVED_CV_PROFILE } from '../db/data/headways.observed'
import { SHARED_CV, SHARED_CV_BLOCKS } from '../db/data/headways.shared'
import type { ServiceDay } from '../db/data/service-hours'
import { dayTypeOf } from './observedHeadways'
import { sharedKey, tjDirOf } from './tjHops'

/*
 * How long a rider waits to board, for the search's ranking and the journey
 * estimate alike (docs/adr/tj-shared-waits.md).
 *
 * TransJakarta waits are bunched: buses held up by the same traffic arrive in
 * pairs, and a rider is more likely to turn up in the long gap behind a pair,
 * so the wait is h(1 + CV²)/2 rather than h/2. On a stretch several lines
 * share, any of their buses will do: the merged stream's rate is the lines'
 * rates added, and its CV, fitted on its own (fit:tj-shared-waits), carries how
 * often they arrive together.
 *
 * Everything else, and everything with observed headways switched off, waits
 * half the boarded line's headway, exactly as the search always charged.
 */

const DAY_S = 86_400
const hourOf = (clockS: number) => Math.floor((((clockS % DAY_S) + DAY_S) % DAY_S) / 3600)

/*
 * Ceiling on the CV a single line's wait is scaled by, so a wait averages at
 * most one full headway. The profile's p90 sits right at it (median 0.63, p90
 * 0.99); the tail past it runs to 4.78 and is led by the topology-mismatch lines
 * (4@F 3.07, 3F@F 1.66) and the 05:00 ramp-ups, where the spread is the
 * timetable changing gear within the hour rather than buses bunching.
 */
export const MAX_WAIT_CV = 1

/**
 * How much longer than half a headway a rider waits on this line-direction,
 * (1 + CV²), from the observed spread of consecutive headways (`fit:headways`).
 *
 * Half a headway is only the wait when buses come evenly. They do not: traffic
 * holds a bus up, the one behind catches it, and a pair arrives with a long gap
 * behind them. A rider turning up at random is more likely to land in the long
 * gap, so the expected wait is h(1 + CV²)/2. On 6 to Ragunan, which meets the
 * traffic south of Underpass Kuningan, a CV around 0.8 makes it 1.6 times the
 * even-service wait.
 *
 * The hour's own cell, else a neighbouring hour's: the CV is missing exactly
 * where the headway profile was interpolated. 1 (no adjustment) with neither.
 */
export function bunchingFactor(dayType: 'WD' | 'WE', clockS: number, lineDir: string): number {
  const hour = hourOf(clockS)
  for (const h of [hour, (hour + 23) % 24, (hour + 1) % 24]) {
    const cv = OBSERVED_CV_PROFILE[`${dayType}:${h}:${lineDir}`]
    if (cv !== undefined) return 1 + Math.min(cv, MAX_WAIT_CV) ** 2
  }
  return 1
}

/** First hour of each shared-CV block, from the generated labels ('07-10' -> 7). */
const SHARED_BLOCK_STARTS = SHARED_CV_BLOCKS.map(label => Number(label.slice(0, 2)))

function sharedBlockAt(clockS: number): number {
  const hour = hourOf(clockS)
  let block = 0
  SHARED_BLOCK_STARTS.forEach((start, b) => {
    if (hour >= start) block = b
  })
  return block
}

/*
 * The merged stream's CV when the fit has no cell for it. Several lines'
 * buses, each running to its own pattern, superpose towards a Poisson stream,
 * whose CV is 1: a rider waits one shared headway on average. The best single
 * line's wait still caps it, so this never makes sharing a stretch look worse
 * than riding one line of it.
 */
export const UNFITTED_SHARED_CV = 1

/*
 * The search's own default for a line with no headway at all (plan.ts
 * DEFAULTS.defaultHeadwayS), for the wait model it is handed in place of it.
 */
export const DEFAULT_HEADWAY_S = 900

export interface WaitContext {
  day: ServiceDay
  /**
   * When the rider reaches the stop, seconds since local midnight. Picks the
   * hour and block of the bunching data; the headways are already the request's.
   */
  clockS: number
  /** The headway map the search uses (`line@stop`, then `line`). */
  headways: ReadonlyMap<string, number>
  /** Observed headways in force (utils/observedFlag.ts). Off means plain h/2. */
  observed: boolean
}

const headwayOf = (headways: ReadonlyMap<string, number>, line: string, stop: string) =>
  headways.get(`${line}@${stop}`) ?? headways.get(line)

/**
 * Expected wait, in seconds, to board any of `lines` at `stop` heading for
 * `next`. `lines[0]` is the line actually boarded; the rest run the same
 * stretch. Undefined when no line has a headway and no fallback is given.
 *
 * - Not TransJakarta, or observed headways off: half the boarded line's headway.
 * - One TJ line: its headway, bunched (bunchingFactor, by its direction here).
 * - Several: the shared headway 1 / Σ(1 / h_i), bunched by the merged stream's
 *   fitted CV (UNFITTED_SHARED_CV without a cell), and never longer than the
 *   best single line's own bunched wait.
 */
export function expectedWaitS(
  lines: readonly string[],
  stop: string,
  next: string,
  ctx: WaitContext,
  fallbackHeadwayS?: number
): number | undefined {
  const boarded = lines[0]
  if (boarded === undefined) return undefined
  if (!ctx.observed || !stop.startsWith('TJ-')) {
    const h = headwayOf(ctx.headways, boarded, stop) ?? fallbackHeadwayS
    return h === undefined ? undefined : h / 2
  }

  const dayType = dayTypeOf(ctx.day)
  let rate = 0
  let best = Infinity
  for (const line of lines) {
    const h = headwayOf(ctx.headways, line, stop) ?? fallbackHeadwayS
    if (h === undefined || h <= 0) continue
    rate += 1 / h
    const dir = tjDirOf(line, stop, next)
    const wait = (h / 2) * (dir ? bunchingFactor(dayType, ctx.clockS, `${line}@${dir}`) : 1)
    if (wait < best) best = wait
  }
  if (rate === 0) return undefined
  if (lines.length === 1) return best

  const key = sharedKey(stop, next, lines)
  const cv = SHARED_CV[`${dayType}:${sharedBlockAt(ctx.clockS)}:${key}`]
    ?? SHARED_CV[`${dayType}:*:${key}`]
    ?? UNFITTED_SHARED_CV
  return Math.min(best, (1 / rate / 2) * (1 + cv * cv))
}
