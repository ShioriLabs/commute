import { type ArrivalOptions, DEFAULT_ARRIVAL_OPTIONS, extractArrivals, type StopOrder } from './arrivals'
import { SnapshotCollector } from './collector'
import { type HealthGate, healthySecondsByHour, intervals, wibHour } from './health'
import { lines, type SnapshotRecord } from './snapshots'

/*
 * One WIB day of observed arrivals, reduced to what the model needs.
 *
 * Raw snapshots are ~10x bigger than anything the fit reads, and re-reading 30
 * days of them takes minutes, so each day is aggregated once and cached. The
 * shape is the n / Σh / Σh² of the ADR: enough to recover the rate headway
 * (healthy time / n), the mean gap and the bunching CV for any pooling of days
 * without going back to the snapshots.
 */

export type DayType = 'WD' | 'WE'

/** Arrivals inside healthy time, then consecutive healthy gaps: count, Σh, Σh². */
export type Cell = [n: number, g: number, sumH: number, sumH2: number]

export interface DayAggregate {
  schema: 1
  /** WIB day, YYYYMMDD. */
  day: string
  dayType: DayType
  /** First and last snapshot, ms. 0 when the day held none. */
  t0: number
  t1: number
  /** Healthy seconds by WIB hour of day (24 entries). */
  healthySecByHour: number[]
  /** `${line}@TJ-${stop}@${dir}` -> WIB hour -> cell. */
  keys: Record<string, Record<string, Cell>>
}

export const AGGREGATE_SCHEMA = 1

/**
 * Weekend vs weekday. Public holidays are not recognised: a holiday weekday
 * lands in WD and reads as a quiet weekday. None fell inside the collection
 * window at the time of writing; revisit when one does.
 */
export function dayTypeOf(day: string): DayType {
  const weekday = new Date(`${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6, 8)}T00:00:00Z`).getUTCDay()
  const weekend = weekday === 0 || weekday === 6
  return weekend ? 'WE' : 'WD'
}

/** Reduce an already-folded day. Split from the file reading so it is testable on its own. */
export function aggregateCollected(
  day: string,
  collector: SnapshotCollector,
  order: StopOrder,
  options: ArrivalOptions = DEFAULT_ARRIVAL_OPTIONS
): DayAggregate {
  const out: DayAggregate = {
    schema: AGGREGATE_SCHEMA,
    day,
    dayType: dayTypeOf(day),
    t0: 0,
    t1: 0,
    healthySecByHour: new Array<number>(24).fill(0),
    keys: {}
  }
  if (collector.snapCount === 0) return out

  const unhealthy = intervals(collector.gaps)
  out.t0 = collector.t0
  out.t1 = collector.t1
  out.healthySecByHour = healthySecondsByHour(collector.t0, collector.t1, unhealthy.merged)

  const { arrivals } = extractArrivals(collector.series.values(), order, options)
  for (const [key, unsorted] of arrivals) {
    const times = [...unsorted].sort((a, b) => a - b)
    const byHour: Record<string, Cell> = {}
    const cell = (t: number): Cell => byHour[wibHour(t)] ??= [0, 0, 0, 0]
    for (let i = 0; i < times.length; i++) {
      const t = times[i]!
      if (!unhealthy.contains(t)) cell(t)[0]++
      if (i === 0 || unhealthy.overlaps(times[i - 1]!, t)) continue
      const h = (t - times[i - 1]!) / 1000
      const c = cell(t)
      c[1]++
      c[2] += h
      c[3] += h * h
    }
    const used = Object.fromEntries(Object.entries(byHour).filter(([, c]) => c[0] > 0 || c[1] > 0))
    if (Object.keys(used).length > 0) out.keys[key] = used
  }
  return out
}

export async function aggregateDay(
  day: string,
  files: readonly string[],
  order: StopOrder,
  gate: HealthGate,
  options: ArrivalOptions = DEFAULT_ARRIVAL_OPTIONS
): Promise<DayAggregate> {
  const collector = new SnapshotCollector(new Set(order.keys()), gate)
  for (const file of files) {
    for await (const line of lines(file)) {
      if (line) collector.add(JSON.parse(line) as SnapshotRecord)
    }
  }
  return aggregateCollected(day, collector, order, options)
}
