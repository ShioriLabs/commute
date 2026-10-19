import { inWindow, type RouteLeg, type ServiceWindow } from '@commute/tsundere'
import { TJ_RUNTIME_BLOCKS, TJ_RUNTIMES, type TjRuntimeLine } from '../db/data/runtimes.planner'
import type { ServiceDay } from '../db/data/service-hours'
import { findInterliningLineCodes } from './interlining'
import { dayTypeOf } from './observedHeadways'
import { stationCodeOf } from './ids'
import { expectedWaitS } from './tjWaits'

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

interface HopRef {
  line: TjRuntimeLine
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
      index.set(`${code}|${line.stops[hop]}>${line.stops[hop + 1]}`, { line, hop })
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
  /** Observed headways in force for this request; off waits plain h/2 (utils/tjWaits.ts). Default on. */
  observed?: boolean
  statistic?: RuntimeStatistic
}

/**
 * The expected wait and the ride for one TransJakarta leg, given when the rider
 * is standing at its boarding stop. Null when it cannot be estimated honestly:
 * not a TJ leg, no headway, every line that serves it closed by the time a bus
 * would come, or no serving line whose hops the table can price.
 *
 * - Wait: utils/tjWaits.ts, the same model the search ranks by. A leg on a
 *   stretch several lines share waits for any of them (findInterliningLineCodes,
 *   narrowed to the lines running when the rider arrives).
 * - Ride: each hop's median (or p75) in the block the running clock is in, so a
 *   leg crossing 10:00 changes block halfway. Hops without a cell are priced at
 *   the leg's own pace if MIN_PRICED_SHARE of its metres are measured. Priced on
 *   the boarded line, else the first other serving line the table covers: they
 *   run the same road, and a line whose hops were never reported (4D's
 *   Kuningan Madya -> Setiabudi Integritas) must not sink the estimate.
 * - Bias: summed medians undershoot a whole trip (right-skewed hops), so the
 *   line's trip-sum bias in the boarding block is applied in proportion to how
 *   much of the line the leg covers. Not applied to p75 sums.
 */
export function estimateTjLeg(leg: RideLeg, atS: number, inputs: TjEstimateInputs): { waitS: number, rideS: number } | null {
  if (leg.operator !== 'TJ' || leg.stationIds.length < 2) return null
  const openAt = (lineCode: string, clockS: number) => {
    const window = inputs.serviceHours.get(lineCode)
    return !window || inWindow(((clockS % DAY_S) + DAY_S) % DAY_S, window)
  }
  const sharing = findInterliningLineCodes('TJ', leg.stationIds.map(id => stationCodeOf('TJ', id)))
  const serving = [leg.lineCode, ...sharing.filter(code => code !== leg.lineCode)].filter(code => openAt(code, atS))
  if (serving.length === 0) return null

  const wait = expectedWaitS(serving, leg.fromStationId, leg.stationIds[1]!, {
    day: inputs.day,
    clockS: atS,
    headways: inputs.headways,
    observed: inputs.observed ?? true
  })
  if (wait === undefined) return null
  const waitS = Math.round(wait)
  const boardS = atS + waitS
  if (!serving.some(code => openAt(code, boardS))) return null

  for (const lineCode of serving) {
    const rideS = rideOn(lineCode, leg, boardS, inputs)
    if (rideS !== null) return { waitS, rideS }
  }
  return null
}

/** The leg ridden on one line from `boardS`, or null when the table cannot price it on that line. */
function rideOn(lineCode: string, leg: RideLeg, boardS: number, inputs: TjEstimateInputs): number | null {
  const dayType = dayTypeOf(inputs.day)
  const statistic = inputs.statistic ?? 'median'
  const idx = getIndex()
  let clockS = boardS
  let measuredS = 0
  let measuredM = 0
  let unmeasuredM = 0
  let line: TjRuntimeLine | undefined
  for (let i = 0; i < leg.stationIds.length - 1; i++) {
    const ref = idx.get(`${lineCode}|${leg.stationIds[i]}>${leg.stationIds[i + 1]}`)
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
  return Math.round(rideS)
}
