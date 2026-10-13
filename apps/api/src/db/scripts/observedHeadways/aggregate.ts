import { createHash } from 'node:crypto'
import { HOLIDAYS } from '@commute/constants'
import { type ArrivalOptions, DEFAULT_ARRIVAL_OPTIONS, extractArrivals, type StopOrder } from './arrivals'
import { REPLAY_WINDOW_MS, SILENCE_GAP_MS, SnapshotCollector } from './collector'
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
 * Weekend vs weekday, with public holidays on the weekend side.
 *
 * Mirrors the runtime: `serviceDay()` maps a holiday to SUN, which reads the
 * pooled weekend model, so a holiday's snapshots must train that model rather
 * than dilute the weekday one with a quiet "weekday".
 */
export function dayTypeOf(day: string): DayType {
  return serviceDayOf(day) === 'WD' ? 'WD' : 'WE'
}

/**
 * The service day the runtime would read for a WIB day: SUN for a Sunday or a
 * public holiday, SAT for a Saturday, WD otherwise. The schedule tables are keyed
 * this way, so the fallback baseline needs it, not just weekday/weekend.
 */
export function serviceDayOf(day: string): 'WD' | 'SAT' | 'SUN' {
  const iso = `${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6, 8)}`
  if (HOLIDAYS.has(iso)) return 'SUN'
  const weekday = new Date(`${iso}T00:00:00Z`).getUTCDay()
  if (weekday === 0) return 'SUN'
  if (weekday === 6) return 'SAT'
  return 'WD'
}

/**
 * Everything, besides the snapshot files themselves, that decides what an
 * aggregate contains: the stop order and direction assignment, the health gate,
 * the arrival options and the collector's gap constants.
 *
 * A cached day is reusable only if this matches. Without it, a TJ import that
 * changed a corridor's path, or a tweak to the gate, would silently keep feeding
 * old aggregates into the factors and scales with nothing reporting it.
 */
export function aggregationFingerprint(
  order: StopOrder,
  gate: HealthGate,
  options: ArrivalOptions = DEFAULT_ARRIVAL_OPTIONS
): string {
  const orderEntries = [...order].map(([line, dirs]) => [line, [...dirs.F], [...dirs.R]])
  const material = JSON.stringify({
    order: orderEntries,
    gate,
    options: { maxObsGapMs: options.maxObsGapMs, interpolate: options.interpolate },
    silenceGapMs: SILENCE_GAP_MS,
    replayWindowMs: REPLAY_WINDOW_MS
  })
  return createHash('sha256').update(material).digest('hex').slice(0, 16)
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
