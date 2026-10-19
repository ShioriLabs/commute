import { parseArgs } from 'node:util'
import { TOPOLOGY } from '../data/topology'
import { buildOrder, DEFAULT_ARRIVAL_OPTIONS, emptyStats, extractPassings } from './observedHeadways/arrivals'
import { dayTypeOf, serviceDayOf } from './observedHeadways/aggregate'
import { SnapshotCollector } from './observedHeadways/collector'
import { DEFAULT_GATE, healthySecondsByHour, intervals, wibHour } from './observedHeadways/health'
import { dayFiles, type Dir, lines, type SnapshotRecord } from './observedHeadways/snapshots'
import { hops, splitTrips } from './observedHeadways/trips'

/*
 * Measurement pass for TJ run times and service windows (docs/tj-observed-timings.md,
 * "First step"). Builds nothing: it reports how much of ward's sample turns into
 * trips and hop times, so we know whether per-hop run times are viable or only
 * end-to-end times are.
 *
 *   pnpm --filter api analyze:tj-trips --dir <archive dir> [--days N] [--lines 1,13E,9C]
 *     [--min-hop-n 30]
 *
 * A trip is one bus's passings along one line and direction with the stop index
 * going up (observedHeadways/trips.ts).
 *
 * Both terminus hops are structurally unusable. The last one is never seen: at
 * the terminus `next_stops` jumps to the other direction instead of moving on.
 * The first one carries the layover, because a bus standing at the origin already
 * shows the origin as its next stop. So a trip is "full" when it passed stop 1 and
 * the second-to-last stop, its end-to-end time runs between those two, and
 * viability is judged on the interior hops only.
 */

const { values: args } = parseArgs({
  options: {
    'dir': { type: 'string' },
    'days': { type: 'string' },
    'lines': { type: 'string', default: '1,13E,9C' },
    'min-hop-n': { type: 'string', default: '30' }
  }
})

const MIN_HOP_N = Number(args['min-hop-n'])
const FOCUS = args.lines!.split(',').filter(Boolean)
/**
 * A first bus counts only if the collector was mostly healthy this long before
 * it, and a last bus likewise after it: otherwise an earlier or later bus could
 * have gone unseen.
 */
const EDGE_WINDOW_MS = 30 * 60_000
const EDGE_MIN_HEALTHY_SHARE = 0.5

const BLOCKS = [[0, 5], [5, 7], [7, 10], [10, 16], [16, 20], [20, 24]] as const
const blockOf = (t: number) => BLOCKS.findIndex(([a, b]) => wibHour(t) >= a && wibHour(t) < b)
const blockLabel = (b: number) => `${String(BLOCKS[b]![0]).padStart(2, '0')}-${String(BLOCKS[b]![1]).padStart(2, '0')}`

const quantile = (sorted: readonly number[], q: number) =>
  sorted.length === 0 ? NaN : sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!
const sortNum = (xs: readonly number[]) => [...xs].sort((a, b) => a - b)
const hhmm = (t: number) => {
  const h = wibHour(t), m = new Date(t).getUTCMinutes()
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/** Cumulative metres per stop index, by line and direction, from TOPOLOGY's cumM. */
function stopDistances() {
  const out = new Map<string, Record<Dir, (number | undefined)[]>>()
  for (const line of TOPOLOGY) {
    if (line.operator !== 'TJ') continue
    const forward = line.path.filter(s => !s.passThrough)
    const total = line.path.at(-1)?.cumM
    const reverse = line.pathReverse
      ? line.pathReverse.filter(s => !s.passThrough).map(s => s.cumM)
      : [...forward].reverse().map(s => (s.cumM === undefined || total === undefined ? undefined : total - s.cumM))
    out.set(line.lineCode, { F: forward.map(s => s.cumM), R: reverse })
  }
  return out
}

interface LineDirStats {
  trips: number
  full: number
  /** dayType|block -> full-trip durations, ms */
  endToEnd: Map<string, number[]>
  /** `${from}|${dayType}|${block}` -> hop durations, ms */
  hops: Map<string, number[]>
}

async function main() {
  if (!args.dir) throw new Error('--dir <dir> is required')
  const all = dayFiles(args.dir)
  const days = args.days ? all.slice(-Number(args.days)) : all
  if (days.length === 0) throw new Error(`no snapshot files in ${args.dir}`)

  const order = buildOrder(TOPOLOGY)
  const distances = stopDistances()
  const stats = new Map<string, LineDirStats>()
  const statsFor = (key: string) => {
    let s = stats.get(key)
    if (!s) stats.set(key, s = { trips: 0, full: 0, endToEnd: new Map(), hops: new Map() })
    return s
  }
  const transitionStats = emptyStats()
  /** `${line}@${dir}` -> day -> [first, last] origin passing, with whether each edge sat in healthy time. */
  const windows = new Map<string, Map<string, { first: number, last: number, firstOk: boolean, lastOk: boolean }>>()
  const healthyByDayType = { WD: new Array<number>(BLOCKS.length).fill(0), WE: new Array<number>(BLOCKS.length).fill(0) }

  console.log(`## Days (${days.length})\n`)
  console.log('day       svc  snaps   healthy h   ' + BLOCKS.map((_, b) => blockLabel(b)).join('  '))
  for (const { day, files } of days) {
    const collector = new SnapshotCollector(new Set(order.keys()), DEFAULT_GATE)
    for (const file of files) {
      for await (const line of lines(file)) {
        if (line) collector.add(JSON.parse(line) as SnapshotRecord)
      }
    }
    const dayType = dayTypeOf(day)
    if (collector.snapCount === 0) {
      console.log(`${day}  ${serviceDayOf(day).padEnd(3)}  0`)
      continue
    }
    const unhealthy = intervals(collector.gaps)
    const byHour = healthySecondsByHour(collector.t0, collector.t1, unhealthy.merged)
    const byBlock = BLOCKS.map(([a, b]) => byHour.slice(a, b).reduce((x, y) => x + y, 0) / 3600)
    byBlock.forEach((h, b) => healthyByDayType[dayType][b]! += h)
    const total = byBlock.reduce((x, y) => x + y, 0)
    console.log(`${day}  ${serviceDayOf(day).padEnd(3)}  ${String(collector.snapCount).padStart(5)}  ${total.toFixed(1).padStart(9)}   ${byBlock.map(h => h.toFixed(1).padStart(5)).join('  ')}`)

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
      const passings = extractPassings(list, order, DEFAULT_ARRIVAL_OPTIONS, transitionStats)
      for (const trip of splitTrips(passings)) {
        const key = `${trip.route}@${trip.dir}`
        const s = statsFor(key)
        s.trips++
        const stopCount = order.get(trip.route)![trip.dir].size
        // Service window edges are read at stop 1, the first passing that isn't layover.
        const start = trip.passings.find(x => x.index === 1)
        const end = trip.passings.find(x => x.index === stopCount - 2)
        if (start) {
          let w = windows.get(key)
          if (!w) windows.set(key, w = new Map())
          const cur = w.get(day)
          if (!cur) {
            w.set(day, { first: start.t, last: start.t, firstOk: healthyBefore(start.t), lastOk: healthyAfter(start.t) })
          } else {
            if (start.t < cur.first) Object.assign(cur, { first: start.t, firstOk: healthyBefore(start.t) })
            if (start.t > cur.last) Object.assign(cur, { last: start.t, lastOk: healthyAfter(start.t) })
          }
        }
        if (start && end && stopCount > 3) {
          s.full++
          const k = `${dayType}|${blockOf(start.t)}`
          let list = s.endToEnd.get(k)
          if (!list) s.endToEnd.set(k, list = [])
          list.push(end.t - start.t)
        }
        for (const hop of hops(trip, unhealthy)) {
          const k = `${hop.from}|${dayType}|${blockOf(hop.t)}`
          let list = s.hops.get(k)
          if (!list) s.hops.set(k, list = [])
          list.push(hop.durationMs)
        }
      }
    }
  }

  console.log('\nHealthy hours summed over days, by day type and block:')
  for (const dt of ['WD', 'WE'] as const) {
    console.log(`  ${dt}  ${healthyByDayType[dt].map((h, b) => `${blockLabel(b)} ${h.toFixed(1)}h`).join('  ')}`)
  }
  const ts = transitionStats
  console.log(`\nTransitions ${ts.transitions}: adjacent ${ts.adjacent}, jump ${ts.jump}, unknown stop ${ts.unknownStop}, wide gap ${ts.wideGap}, route change ${ts.routeChange}, ambiguous dir ${ts.ambiguousDir}`)

  // ── focus lines in detail ──
  for (const line of FOCUS) {
    for (const dir of ['F', 'R'] as Dir[]) {
      const key = `${line}@${dir}`
      const s = stats.get(key)
      const ord = order.get(line)
      if (!ord) {
        console.log(`\n## ${key}: not in TOPOLOGY`)
        continue
      }
      const stops = [...ord[dir]].sort((a, b) => a[1] - b[1]).map(([station]) => station)
      console.log(`\n## ${key} (${stops.length} stops): ${s?.trips ?? 0} trips, ${s?.full ?? 0} full`)
      if (!s) continue
      console.log('\nEnd-to-end, full trips, stop 1 to second-to-last (min): n / p25 / p50 / p90')
      for (const dt of ['WD', 'WE']) {
        const cells = BLOCKS.map((_, b) => {
          const xs = sortNum(s.endToEnd.get(`${dt}|${b}`) ?? []).map(ms => ms / 60_000)
          return xs.length === 0 ? `${blockLabel(b)} -` : `${blockLabel(b)} ${xs.length}/${quantile(xs, 0.25).toFixed(0)}/${quantile(xs, 0.5).toFixed(0)}/${quantile(xs, 0.9).toFixed(0)}`
        })
        console.log(`  ${dt}  ${cells.join('   ')}`)
      }
      console.log('\nHops, WD all blocks: from -> to, metres, n, p25/p50/p90 s, km/h at p50; then n per WD block | per WE block')
      const cum = distances.get(line)?.[dir] ?? []
      for (let i = 0; i < stops.length - 1; i++) {
        const xs = sortNum(BLOCKS.flatMap((_, b) => s.hops.get(`${i}|WD|${b}`) ?? [])).map(ms => ms / 1000)
        const metres = cum[i + 1] !== undefined && cum[i] !== undefined ? cum[i + 1]! - cum[i]! : undefined
        const kmh = metres !== undefined && xs.length > 0 ? (metres / quantile(xs, 0.5)) * 3.6 : NaN
        const perBlock = ['WD', 'WE'].map(dt => BLOCKS.map((_, b) => String(s.hops.get(`${i}|${dt}|${b}`)?.length ?? 0).padStart(4)).join('')).join(' |')
        console.log(`  ${String(i).padStart(2)} ${stops[i]} -> ${stops[i + 1]}  ${String(metres ?? '?').padStart(5)}m  n=${String(xs.length).padStart(4)}  ${xs.length ? `${quantile(xs, 0.25).toFixed(0)}/${quantile(xs, 0.5).toFixed(0)}/${quantile(xs, 0.9).toFixed(0)}` : '-'}  ${Number.isNaN(kmh) ? '' : `${kmh.toFixed(0)}km/h`}  |${perBlock}`)
      }
      console.log('\nStop-1 passings per day, first / last (* = collector under half healthy in the 30 min before the first / after the last, so the edge is untrusted)')
      for (const [day, w] of [...(windows.get(key) ?? new Map())].sort()) {
        console.log(`  ${day} ${serviceDayOf(day)}  ${hhmm(w.first)}${w.firstOk ? ' ' : '*'}  ${hhmm(w.last)}${w.lastOk ? ' ' : '*'}`)
      }
    }
  }

  // ── every line: is per-hop viable? ──
  console.log(`\n## All lines: share of interior hops (terminus hops excluded) with >= ${MIN_HOP_N} observations, per WD/WE block`)
  console.log('line@dir   stops  trips  full   ' + ['WD', 'WE'].flatMap(dt => BLOCKS.map((_, b) => `${dt} ${blockLabel(b)}`)).join(' '))
  const summary = { lineDirs: 0, viableWdMidday: 0, viableWdPeaks: 0 }
  for (const [line, ord] of [...order].sort((a, b) => a[0].localeCompare(b[0], 'en', { numeric: true }))) {
    for (const dir of ['F', 'R'] as Dir[]) {
      const key = `${line}@${dir}`
      const s = stats.get(key)
      const hopCount = ord[dir].size - 1
      // Hops 1 .. hopCount-2: hop 0 carries the layover and the last hop is never seen.
      const interior = hopCount - 2
      if (interior < 1) continue
      summary.lineDirs++
      const shares = ['WD', 'WE'].flatMap(dt => BLOCKS.map((_, b) => {
        let ok = 0
        for (let i = 1; i <= interior; i++) if ((s?.hops.get(`${i}|${dt}|${b}`)?.length ?? 0) >= MIN_HOP_N) ok++
        return ok / interior
      }))
      if (shares[3]! >= 0.8) summary.viableWdMidday++
      if (shares[2]! >= 0.8 && shares[4]! >= 0.8) summary.viableWdPeaks++
      console.log(`${key.padEnd(10)} ${String(hopCount + 1).padStart(5)} ${String(s?.trips ?? 0).padStart(6)} ${String(s?.full ?? 0).padStart(5)}   ${shares.map(x => `${(x * 100).toFixed(0)}%`.padStart(8)).join(' ')}`)
    }
  }
  console.log(`\n${summary.viableWdMidday}/${summary.lineDirs} line-directions have >= ${MIN_HOP_N} obs on >= 80% of interior hops in WD 10-16; ${summary.viableWdPeaks} also in both WD peaks (07-10, 16-20).`)
}

void main()
