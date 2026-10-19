import * as path from 'node:path'
import { parseArgs } from 'node:util'
import { TOPOLOGY } from '../data/topology'
import { buildOrder, emptyStats } from './observedHeadways/arrivals'
import { blockLabel, loadDayTrips, RUNTIME_BLOCKS } from './observedHeadways/dayTrips'
import { DEFAULT_GATE, wibHour } from './observedHeadways/health'
import { lineGeometry } from './observedHeadways/runtimes'
import type { Dir } from './observedHeadways/snapshots'

/*
 * Measurement pass for TJ run times and service windows (docs/tj-observed-timings.md,
 * "Measurement pass"). Builds nothing: it reports how much of ward's sample turns
 * into trips and hop times. fit:tj-runtimes is the step that produces data.
 *
 *   pnpm --filter api analyze:tj-trips --dir <archive dir> [--cache <dir>] [--days N]
 *     [--lines 1,13E,9C] [--min-hop-n 30]
 *
 * Trips, hops and window edges come from observedHeadways/dayTrips.ts, cached per
 * day (shared with fit:tj-runtimes). Both terminus hops are structurally
 * unusable (see there), so viability is judged on the interior hops only.
 */

const { values: args } = parseArgs({
  options: {
    'dir': { type: 'string' },
    'cache': { type: 'string' },
    'days': { type: 'string' },
    'lines': { type: 'string', default: '1,13E,9C' },
    'min-hop-n': { type: 'string', default: '30' }
  }
})

const MIN_HOP_N = Number(args['min-hop-n'])
const FOCUS = args.lines!.split(',').filter(Boolean)
const BLOCKS = RUNTIME_BLOCKS

const quantile = (sorted: readonly number[], q: number) =>
  sorted.length === 0 ? NaN : sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!
const sortNum = (xs: readonly number[]) => [...xs].sort((a, b) => a - b)
const hhmm = (t: number) => {
  const h = wibHour(t), m = new Date(t).getUTCMinutes()
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

async function main() {
  if (!args.dir) throw new Error('--dir <dir> is required')
  const order = buildOrder(TOPOLOGY)
  const geometry = lineGeometry(TOPOLOGY)
  const days = await loadDayTrips(args.dir, args.cache ?? path.join(args.dir, '.fit-cache'), order, DEFAULT_GATE, args.days ? Number(args.days) : undefined)
  if (days.length === 0) throw new Error(`no snapshot files in ${args.dir}`)

  /** `${dt}|${line}@${dir}|${hop}|${block}` and `${dt}|${line}@${dir}|${block}`, pooled over days. */
  const hops = new Map<string, number[]>()
  const trips = new Map<string, number[]>()
  const counts = new Map<string, [number, number]>()
  const add = (map: Map<string, number[]>, key: string, xs: readonly number[]) => {
    const list = map.get(key)
    if (list) list.push(...xs)
    else map.set(key, [...xs])
  }
  const transitions = emptyStats()
  const healthyByDayType = { WD: new Array<number>(BLOCKS.length).fill(0), WE: new Array<number>(BLOCKS.length).fill(0) }

  console.log(`## Days (${days.length})\n`)
  console.log('day       svc  snaps   healthy h   ' + BLOCKS.map((_, b) => blockLabel(b)).join('  '))
  for (const day of days) {
    if (day.snaps === 0) {
      console.log(`${day.day}  ${day.serviceDay.padEnd(3)}  0`)
      continue
    }
    const byBlock = day.healthySecByBlock.map(s => s / 3600)
    byBlock.forEach((h, b) => healthyByDayType[day.dayType][b]! += h)
    const total = byBlock.reduce((x, y) => x + y, 0)
    console.log(`${day.day}  ${day.serviceDay.padEnd(3)}  ${String(day.snaps).padStart(5)}  ${total.toFixed(1).padStart(9)}   ${byBlock.map(h => h.toFixed(1).padStart(5)).join('  ')}`)
    for (const [k, v] of Object.entries(day.transitions) as [keyof typeof transitions, number][]) transitions[k] += v
    for (const [key, xs] of Object.entries(day.hops)) add(hops, `${day.dayType}|${key}`, xs)
    for (const [key, xs] of Object.entries(day.trips)) add(trips, `${day.dayType}|${key}`, xs)
    for (const [ld, [n, full]] of Object.entries(day.tripCounts)) {
      const c = counts.get(ld) ?? [0, 0]
      counts.set(ld, [c[0] + n, c[1] + full])
    }
  }

  console.log('\nHealthy hours summed over days, by day type and block:')
  for (const dt of ['WD', 'WE'] as const) {
    console.log(`  ${dt}  ${healthyByDayType[dt].map((h, b) => `${blockLabel(b)} ${h.toFixed(1)}h`).join('  ')}`)
  }
  const ts = transitions
  console.log(`\nTransitions ${ts.transitions}: adjacent ${ts.adjacent}, jump ${ts.jump}, unknown stop ${ts.unknownStop}, wide gap ${ts.wideGap}, route change ${ts.routeChange}, ambiguous dir ${ts.ambiguousDir}`)

  const hopsOf = (dt: string, key: string, i: number, b: number) => hops.get(`${dt}|${key}|${i}|${b}`) ?? []

  // ── focus lines in detail ──
  for (const line of FOCUS) {
    for (const dir of ['F', 'R'] as Dir[]) {
      const key = `${line}@${dir}`
      const geo = geometry.get(key)
      if (!geo) {
        console.log(`\n## ${key}: not in TOPOLOGY`)
        continue
      }
      const stops = geo.stops
      const c = counts.get(key)
      console.log(`\n## ${key} (${stops.length} stops): ${c?.[0] ?? 0} trips, ${c?.[1] ?? 0} full`)
      if (!c) continue
      console.log('\nEnd-to-end, full trips, stop 1 to second-to-last (min): n / p25 / p50 / p90')
      for (const dt of ['WD', 'WE']) {
        const cells = BLOCKS.map((_, b) => {
          const xs = sortNum(trips.get(`${dt}|${key}|${b}`) ?? []).map(s => s / 60)
          return xs.length === 0 ? `${blockLabel(b)} -` : `${blockLabel(b)} ${xs.length}/${quantile(xs, 0.25).toFixed(0)}/${quantile(xs, 0.5).toFixed(0)}/${quantile(xs, 0.9).toFixed(0)}`
        })
        console.log(`  ${dt}  ${cells.join('   ')}`)
      }
      console.log('\nHops, WD all blocks: from -> to, metres, n, p25/p50/p90 s, km/h at p50; then n per WD block | per WE block')
      for (let i = 0; i < stops.length - 1; i++) {
        const xs = sortNum(BLOCKS.flatMap((_, b) => hopsOf('WD', key, i, b)))
        const metres = geo.hopMetres[i]
        const kmh = metres !== undefined && xs.length > 0 ? (metres / quantile(xs, 0.5)) * 3.6 : NaN
        const perBlock = ['WD', 'WE'].map(dt => BLOCKS.map((_, b) => String(hopsOf(dt, key, i, b).length).padStart(4)).join('')).join(' |')
        console.log(`  ${String(i).padStart(2)} ${stops[i]} -> ${stops[i + 1]}  ${String(metres ?? '?').padStart(5)}m  n=${String(xs.length).padStart(4)}  ${xs.length ? `${quantile(xs, 0.25).toFixed(0)}/${quantile(xs, 0.5).toFixed(0)}/${quantile(xs, 0.9).toFixed(0)}` : '-'}  ${Number.isNaN(kmh) ? '' : `${kmh.toFixed(0)}km/h`}  |${perBlock}`)
      }
      console.log('\nStop-1 passings per day, first / last (* = collector under half healthy in the 30 min before the first / after the last, so the edge is untrusted)')
      for (const day of days) {
        const w = day.edges[key]
        if (w) console.log(`  ${day.day} ${day.serviceDay}  ${hhmm(w.first)}${w.firstOk ? ' ' : '*'}  ${hhmm(w.last)}${w.lastOk ? ' ' : '*'}`)
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
      const c = counts.get(key)
      const hopCount = ord[dir].size - 1
      // Hops 1 .. hopCount-2: hop 0 carries the layover and the last hop is never seen.
      const interior = hopCount - 2
      if (interior < 1) continue
      summary.lineDirs++
      const shares = ['WD', 'WE'].flatMap(dt => BLOCKS.map((_, b) => {
        let ok = 0
        for (let i = 1; i <= interior; i++) if (hopsOf(dt, key, i, b).length >= MIN_HOP_N) ok++
        return ok / interior
      }))
      if (shares[3]! >= 0.8) summary.viableWdMidday++
      if (shares[2]! >= 0.8 && shares[4]! >= 0.8) summary.viableWdPeaks++
      console.log(`${key.padEnd(10)} ${String(hopCount + 1).padStart(5)} ${String(c?.[0] ?? 0).padStart(6)} ${String(c?.[1] ?? 0).padStart(5)}   ${shares.map(x => `${(x * 100).toFixed(0)}%`.padStart(8)).join(' ')}`)
    }
  }
  console.log(`\n${summary.viableWdMidday}/${summary.lineDirs} line-directions have >= ${MIN_HOP_N} obs on >= 80% of interior hops in WD 10-16; ${summary.viableWdPeaks} also in both WD peaks (07-10, 16-20).`)
}

void main()
