import { inWindow, type RouteLeg, type ServiceWindow } from '@commute/tsundere'
import { TJ_RUNTIME_BLOCKS, TJ_RUNTIMES, type TjRuntimeLine } from '../db/data/runtimes.planner'
import { OBSERVED_CV_PROFILE } from '../db/data/headways.observed'
import type { ServiceDay } from '../db/data/service-hours'
import { dayTypeOf } from './observedHeadways'

/*
 * Estimated TransJakarta ride times for the trip planner, from the observed run
 * times (db/data/runtimes.planner.ts, fitted by `fit:tj-runtimes`; see
 * docs/tj-observed-timings.md).
 *
 * These are ESTIMATES, used only for `estimate` on a journey and, in sort mode,
 * its place in the arrival order (utils/journey-times.ts). They are never
 * stamped onto a leg as a departure or arrival: every client reads those as
 * timetable facts, and TransJakarta has no timetable.
 *
 * Pure lookups over the generated table; the index is built once per isolate.
 */

type RideLeg = Extract<RouteLeg, { type: 'RIDE' }>

/** Which statistic to sum: the median, or the p75 for a more cautious arrival. */
export type RuntimeStatistic = 'median' | 'p75'

/**
 * Share of a leg's metres that must come from measured hops before the rest may
 * be priced at the leg's own pace. Below it the leg gets no estimate at all
 * rather than one mostly made of extrapolation.
 */
export const MIN_PRICED_SHARE = 0.5

const DAY_S = 86_400

/** First hour of each block, from the generated labels ('07-10' -> 7). */
const BLOCK_STARTS = TJ_RUNTIME_BLOCKS.map(label => Number(label.slice(0, 2)))

/** The block a moment falls in. Past midnight it wraps; the day type stays the request's. */
export function blockAt(clockS: number): number {
  const hour = Math.floor((((clockS % DAY_S) + DAY_S) % DAY_S) / 3600)
  let block = 0
  BLOCK_STARTS.forEach((start, b) => {
    if (hour >= start) block = b
  })
  return block
}

/*
 * Ceiling on the CV the wait is scaled by, so a wait averages at most one full
 * headway. The profile's p90 sits right at it (median 0.63, p90 0.99); the tail
 * past it runs to 4.78 and is led by the topology-mismatch lines (4@F 3.07,
 * 3F@F 1.66) and the 05:00 ramp-ups, where the spread is the timetable changing
 * gear within the hour rather than buses bunching.
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
  const hour = Math.floor((((clockS % DAY_S) + DAY_S) % DAY_S) / 3600)
  for (const h of [hour, (hour + 23) % 24, (hour + 1) % 24]) {
    const cv = OBSERVED_CV_PROFILE[`${dayType}:${h}:${lineDir}`]
    if (cv !== undefined) return 1 + Math.min(cv, MAX_WAIT_CV) ** 2
  }
  return 1
}

interface HopRef {
  line: TjRuntimeLine
  /** The table's key, `${line}@${dir}`, which is also the headway profile's. */
  lineDir: string
  hop: number
}

let index: Map<string, HopRef> | undefined

/** `${line}|${from}>${to}` -> the line-direction table and hop position. */
function getIndex(): Map<string, HopRef> {
  if (index) return index
  index = new Map()
  for (const [lineDir, line] of Object.entries(TJ_RUNTIMES)) {
    const code = lineDir.slice(0, lineDir.lastIndexOf('@'))
    for (let hop = 0; hop < line.stops.length - 1; hop++) {
      index.set(`${code}|${line.stops[hop]}>${line.stops[hop + 1]}`, { line, lineDir, hop })
    }
  }
  return index
}

export interface TjEstimateInputs {
  day: ServiceDay
  /** The headway map the search used for this request (fares.ts headwaysFor). */
  headways: ReadonlyMap<string, number>
  /** Service windows for the request's day (fares.ts serviceHoursMap). */
  serviceHours: ReadonlyMap<string, ServiceWindow>
  statistic?: RuntimeStatistic
}

/**
 * The expected wait and the ride for one TransJakarta leg, given when the rider
 * is standing at its boarding stop. Null when it cannot be estimated honestly:
 * not a TJ leg, no headway, the line closed by the time a bus would come, a hop
 * the table does not know, or too little of the leg measured.
 *
 * - Wait: half the headway the search charged at the boarding stop, scaled by
 *   the line-direction's bunching (bunchingFactor). Longer than the search's own
 *   expectedWaitS (plan.ts), which stays at h/2: ranking compares routes, and
 *   this is what a rider will actually stand through.
 * - Ride: each hop's median (or p75) in the block the running clock is in, so a
 *   leg crossing 10:00 changes block halfway. Hops without a cell are priced at
 *   the leg's own pace if MIN_PRICED_SHARE of its metres are measured.
 * - Bias: summed medians undershoot a whole trip (right-skewed hops), so the
 *   line's trip-sum bias in the boarding block is applied in proportion to how
 *   much of the line the leg covers. Not applied to p75 sums.
 */
export function estimateTjLeg(leg: RideLeg, atS: number, inputs: TjEstimateInputs): { waitS: number, rideS: number } | null {
  if (leg.operator !== 'TJ' || leg.stationIds.length < 2) return null
  const headwayS = inputs.headways.get(`${leg.lineCode}@${leg.fromStationId}`) ?? inputs.headways.get(leg.lineCode)
  if (headwayS === undefined) return null
  const idx = getIndex()
  const first = idx.get(`${leg.lineCode}|${leg.stationIds[0]}>${leg.stationIds[1]}`)
  if (!first) return null
  const dayType = dayTypeOf(inputs.day)
  const waitS = Math.round(headwayS / 2 * bunchingFactor(dayType, atS, first.lineDir))
  const boardS = atS + waitS
  const window = inputs.serviceHours.get(leg.lineCode)
  if (window && !inWindow(((boardS % DAY_S) + DAY_S) % DAY_S, window)) return null

  const statistic = inputs.statistic ?? 'median'
  let clockS = boardS
  let measuredS = 0
  let measuredM = 0
  let unmeasuredM = 0
  let line: TjRuntimeLine | undefined
  for (let i = 0; i < leg.stationIds.length - 1; i++) {
    const ref = idx.get(`${leg.lineCode}|${leg.stationIds[i]}>${leg.stationIds[i + 1]}`)
    if (!ref) return null
    line = ref.line
    const metres = ref.line.metres[ref.hop]!
    const bucket = ref.line[dayType][blockAt(clockS)]
    const seconds = bucket ? (statistic === 'p75' ? bucket.p75 : bucket.s)[ref.hop]! : 0
    if (seconds > 0) {
      measuredS += seconds
      measuredM += metres
      clockS += seconds
    } else {
      // Unknown metres cannot be priced at any pace.
      if (metres <= 0) return null
      unmeasuredM += metres
    }
  }
  if (measuredM <= 0 || measuredM < MIN_PRICED_SHARE * (measuredM + unmeasuredM)) return null

  let rideS = measuredS + unmeasuredM * (measuredS / measuredM)
  if (statistic === 'median' && line) {
    const bias = line[dayType][blockAt(boardS)]?.bias ?? 1
    const interior = Math.max(1, line.stops.length - 3)
    rideS *= 1 + (bias - 1) * Math.min(1, (leg.stationIds.length - 1) / interior)
  }
  return { waitS, rideS: Math.round(rideS) }
}
