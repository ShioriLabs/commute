import * as fs from 'node:fs'
import * as path from 'node:path'
import { aggregationFingerprint, dayTypeOf, type DayType, serviceDayOf } from './aggregate'
import { DEFAULT_ARRIVAL_OPTIONS, emptyStats, extractPassings, type StopOrder, type TransitionStats } from './arrivals'
import { SnapshotCollector } from './collector'
import { type HealthGate, healthySecondsByHour, intervals, wibHour } from './health'
import { dayFiles, lines, type SnapshotRecord } from './snapshots'
import { hops, splitTrips } from './trips'

/*
 * One WIB day of reconstructed TJ trips, reduced to what the run-time fit and
 * the measurement report read (docs/tj-observed-timings.md). Cached per day for
 * the same reason as aggregate.ts: re-reading the snapshots takes minutes.
 *
 * Both terminus hops are structurally unusable. The last one is never seen: at
 * the terminus `next_stops` jumps to the other direction instead of moving on.
 * The first one carries the layover, because a bus standing at the origin
 * already shows the origin as its next stop. So trips are timed from stop 1 to
 * the second-to-last stop, and service window edges are read at stop 1.
 */

/** WIB hour blocks [from, to). Hours are too thin at the weekday peaks; blocks pool them. */
export const RUNTIME_BLOCKS = [[0, 5], [5, 7], [7, 10], [10, 16], [16, 20], [20, 24]] as const

export const blockOf = (t: number) => {
  const hour = wibHour(t)
  return RUNTIME_BLOCKS.findIndex(([a, b]) => hour >= a && hour < b)
}

export const blockLabel = (b: number) =>
  `${String(RUNTIME_BLOCKS[b]![0]).padStart(2, '0')}-${String(RUNTIME_BLOCKS[b]![1]).padStart(2, '0')}`

/**
 * A first bus counts only if the collector was mostly healthy this long before
 * it, and a last bus likewise after it: otherwise an earlier or later bus could
 * have gone unseen.
 */
export const EDGE_WINDOW_MS = 30 * 60_000
export const EDGE_MIN_HEALTHY_SHARE = 0.5

export const TRIPS_SCHEMA = 2

/** WIB hours [from, to) in which a stop-1 passing marks night service. */
export const NIGHT_HOURS = [1, 4] as const

/** First and last stop-1 passing of a day, ms, each with whether it can be trusted. */
export interface Edge {
  first: number
  last: number
  firstOk: boolean
  lastOk: boolean
  /** Stop-1 passings that day: a handful is a stray bus, not service. */
  count: number
  /**
   * A bus passed stop 1 during NIGHT_HOURS. A WIB-day archive cuts a 24-hour
   * line at midnight, so its first and last passings say nothing; this does.
   */
  night: boolean
}

export interface DayTrips {
  schema: 2
  /** WIB day, YYYYMMDD. */
  day: string
  dayType: DayType
  serviceDay: 'WD' | 'SAT' | 'SUN'
  snaps: number
  /** Healthy seconds per RUNTIME_BLOCKS entry. */
  healthySecByBlock: number[]
  transitions: TransitionStats
  /** `${line}@${dir}` -> [trips, full trips]. */
  tripCounts: Record<string, [number, number]>
  /** `${line}@${dir}|${hop index}|${block}` -> hop seconds, directly observed and in healthy time. */
  hops: Record<string, number[]>
  /** `${line}@${dir}|${block of the stop-1 passing}` -> stop 1 to second-to-last stop, seconds. */
  trips: Record<string, number[]>
  /** `${line}@${dir}` -> first and last stop-1 passing. */
  edges: Record<string, Edge>
}

const push = (record: Record<string, number[]>, key: string, value: number) => {
  (record[key] ??= []).push(value)
}

/** Reduce an already-folded day. Split from the file reading so it is testable on its own. */
export function collectDayTrips(day: string, collector: SnapshotCollector, order: StopOrder): DayTrips {
  const out: DayTrips = {
    schema: TRIPS_SCHEMA,
    day,
    dayType: dayTypeOf(day),
    serviceDay: serviceDayOf(day),
    snaps: collector.snapCount,
    healthySecByBlock: new Array<number>(RUNTIME_BLOCKS.length).fill(0),
    transitions: emptyStats(),
    tripCounts: {},
    hops: {},
    trips: {},
    edges: {}
  }
  if (collector.snapCount === 0) return out

  const unhealthy = intervals(collector.gaps)
  const byHour = healthySecondsByHour(collector.t0, collector.t1, unhealthy.merged)
  out.healthySecByBlock = RUNTIME_BLOCKS.map(([a, b]) => byHour.slice(a, b).reduce((x, y) => x + y, 0))

  // Share of [from, to] the collector was running and healthy.
  const healthyShare = (from: number, to: number) => {
    const a = Math.max(from, collector.t0), b = Math.min(to, collector.t1)
    if (b <= a) return 0
    let stale = 0
    for (const [x, y] of unhealthy.merged) stale += Math.max(0, Math.min(y, b) - Math.max(x, a))
    return (b - a - stale) / (to - from)
  }
  const healthyBefore = (t: number) => healthyShare(t - EDGE_WINDOW_MS, t) >= EDGE_MIN_HEALTHY_SHARE
  const healthyAfter = (t: number) => healthyShare(t, t + EDGE_WINDOW_MS) >= EDGE_MIN_HEALTHY_SHARE

  for (const list of collector.series.values()) {
    const passings = extractPassings(list, order, DEFAULT_ARRIVAL_OPTIONS, out.transitions)
    for (const trip of splitTrips(passings)) {
      const ld = `${trip.route}@${trip.dir}`
      const counts = out.tripCounts[ld] ??= [0, 0]
      counts[0]++
      const stopCount = order.get(trip.route)![trip.dir].size
      const start = trip.passings.find(x => x.index === 1)
      const end = trip.passings.find(x => x.index === stopCount - 2)
      if (start) {
        const hour = wibHour(start.t)
        const night = hour >= NIGHT_HOURS[0] && hour < NIGHT_HOURS[1]
        const cur = out.edges[ld]
        if (!cur) {
          out.edges[ld] = { first: start.t, last: start.t, firstOk: healthyBefore(start.t), lastOk: healthyAfter(start.t), count: 1, night }
        } else {
          cur.count++
          cur.night ||= night
          if (start.t < cur.first) Object.assign(cur, { first: start.t, firstOk: healthyBefore(start.t) })
          if (start.t > cur.last) Object.assign(cur, { last: start.t, lastOk: healthyAfter(start.t) })
        }
      }
      if (start && end && stopCount > 3) {
        counts[1]++
        push(out.trips, `${ld}|${blockOf(start.t)}`, Math.round((end.t - start.t) / 1000))
      }
      for (const hop of hops(trip, unhealthy)) {
        push(out.hops, `${ld}|${hop.from}|${blockOf(hop.t)}`, Math.round(hop.durationMs / 1000))
      }
    }
  }
  return out
}

export async function aggregateDayTrips(
  day: string,
  files: readonly string[],
  order: StopOrder,
  gate: HealthGate
): Promise<DayTrips> {
  const collector = new SnapshotCollector(new Set(order.keys()), gate)
  for (const file of files) {
    for await (const line of lines(file)) {
      if (line) collector.add(JSON.parse(line) as SnapshotRecord)
    }
  }
  return collectDayTrips(day, collector, order)
}

/**
 * Every day in `dir`, oldest first, from the cache where the archive, the stop
 * order, the gate and the schema are unchanged (see `aggregationFingerprint`).
 */
export async function loadDayTrips(
  dir: string,
  cacheDir: string,
  order: StopOrder,
  gate: HealthGate,
  limit?: number,
  log: (message: string) => void = console.error
): Promise<DayTrips[]> {
  fs.mkdirSync(cacheDir, { recursive: true })
  const fingerprint = aggregationFingerprint(order, gate)
  const all = dayFiles(dir)
  const wanted = limit ? all.slice(-limit) : all
  const out: DayTrips[] = []
  for (const { day, files } of wanted) {
    const source = files.map(f => ({ file: path.basename(f), size: fs.statSync(f).size }))
    const cachePath = path.join(cacheDir, `day-trips-${day}.json`)
    if (fs.existsSync(cachePath)) {
      const cached = JSON.parse(fs.readFileSync(cachePath, 'utf8')) as { source: typeof source, fingerprint: string, trips: DayTrips }
      const same = cached.trips.schema === TRIPS_SCHEMA
        && cached.fingerprint === fingerprint
        && JSON.stringify(cached.source) === JSON.stringify(source)
      if (same) {
        // Recomputed, not trusted: a holiday added since must move the day.
        out.push({ ...cached.trips, dayType: dayTypeOf(day), serviceDay: serviceDayOf(day) })
        continue
      }
    }
    log(`aggregating trips for ${day} (${files.length} file${files.length === 1 ? '' : 's'})`)
    const trips = await aggregateDayTrips(day, files, order, gate)
    fs.writeFileSync(cachePath, JSON.stringify({ source, fingerprint, trips }))
    out.push(trips)
  }
  return out
}
