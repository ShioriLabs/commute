import * as fs from 'node:fs'
import * as path from 'node:path'
import { parseArgs } from 'node:util'
import { TOPOLOGY } from '../data/topology'
import { SERVICE_HOURS } from '../data/service-hours'
import { buildOrder } from './observedHeadways/arrivals'
import { blockLabel, loadDayTrips, RUNTIME_BLOCKS } from './observedHeadways/dayTrips'
import { DEFAULT_GATE } from './observedHeadways/health'
import {
  backtest,
  fitRuntimes,
  fitWindows,
  lineGeometry,
  MIN_STRATUM_BUCKETS,
  poolTrips,
  renderPlannerRuntimes,
  renderRuntimes,
  tripBias,
  vouchedBias,
  vouchedStrata,
  type WindowDay
} from './observedHeadways/runtimes'

/*
 * Fit observed TJ run times and service windows from ward's snapshots
 * (docs/tj-observed-timings.md) and write db/data/runtimes.observed.ts.
 *
 *   pnpm --filter api fit:tj-runtimes --dir <archive dir> [--cache <dir>] [--days N]
 *     [--out <file>] [--planner-out <file>] [--no-write]
 *
 * Days are reduced once and cached (observedHeadways/dayTrips.ts, shared with
 * analyze:tj-trips). The backtest holds out each day in turn and scores every
 * (day type, block, basis) stratum against one constant speed per line; strata
 * that don't beat it are left out of the output. Service windows are printed
 * next to service-hours.ts but never written into it: merging them is a
 * reviewed, separate step.
 *
 * It writes two files from the same fit: runtimes.observed.ts (everything, for
 * analysis; nothing at runtime imports it) and runtimes.planner.ts (the compact
 * slice the planner's estimates read through utils/observedRuntimes.ts).
 */

const OUT_PATH = `${__dirname}/../data/runtimes.observed.ts`
const PLANNER_OUT_PATH = `${__dirname}/../data/runtimes.planner.ts`

const { values: args } = parseArgs({
  options: {
    'dir': { type: 'string' },
    'cache': { type: 'string' },
    'days': { type: 'string' },
    'out': { type: 'string', default: OUT_PATH },
    'planner-out': { type: 'string', default: PLANNER_OUT_PATH },
    'no-write': { type: 'boolean', default: false }
  }
})

const fmt = (n: number) => Number.isFinite(n) ? n.toFixed(3) : '  -  '
const hhmm = (s: number) => `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}`
const naturalCompare = (a: string, b: string) => a.localeCompare(b, 'en', { numeric: true })

async function main() {
  if (!args.dir) throw new Error('--dir <archive dir> is required')
  const order = buildOrder(TOPOLOGY)
  const geometry = lineGeometry(TOPOLOGY)
  const days = await loadDayTrips(args.dir, args.cache ?? path.join(args.dir, '.fit-cache'), order, DEFAULT_GATE, args.days ? Number(args.days) : undefined)
  if (days.length === 0) throw new Error(`no snapshot files in ${args.dir}`)
  const dayCounts: Record<WindowDay, number> = { WD: 0, SAT: 0, SUN: 0 }
  for (const d of days) dayCounts[d.serviceDay]++
  console.log(`${days.length} days, ${days[0]!.day}..${days.at(-1)!.day}: WD ${dayCounts.WD}, SAT ${dayCounts.SAT}, SUN ${dayCounts.SUN}`)

  // ── backtest ──
  const { strata, trips } = backtest(days, geometry)
  const allow = vouchedStrata(strata)
  console.log(`\nHop backtest, leave one day out: median |log err|, model vs one speed per line (ships with >= ${MIN_STRATUM_BUCKETS} buckets and a win)`)
  console.log('  dt  block  basis      buckets   model  baseline')
  for (const s of strata) {
    const ships = allow(s.dt, s.block, s.basis) ? 'ships' : 'dropped'
    console.log(`  ${s.dt}  ${blockLabel(s.block)}  ${s.basis.padEnd(9)} ${String(s.buckets).padStart(8)}   ${fmt(s.model)}  ${fmt(s.baseline)}  ${ships}`)
  }
  console.log('\nTrip backtest (stop 1 to second-to-last = sum of predicted hops, lines with every interior hop priced)')
  console.log('  dt  block  buckets   model  biased  baseline')
  for (const t of trips) {
    const verdict = t.biased < t.model ? 'bias ships' : 'bias dropped'
    console.log(`  ${t.dt}  ${blockLabel(t.block)} ${String(t.buckets).padStart(8)}   ${fmt(t.model)}  ${fmt(t.biased)}  ${fmt(t.baseline)}  ${verdict}`)
  }

  // ── final fit ──
  const fit = fitRuntimes(poolTrips(days), geometry, allow)
  const biasAllowed = vouchedBias(trips)
  const bias = tripBias(fit, geometry, biasAllowed)
  const windows = fitWindows(days)

  console.log('\nCells by basis, per day type and block:')
  for (const dt of ['WD', 'WE'] as const) {
    const line = RUNTIME_BLOCKS.map((_, b) => {
      const c = { OBSERVED: 0, SCALED: 0, DISTANCE: 0 }
      for (const [key, cell] of fit.hops) {
        const [kdt, , , kb] = key.split('|')
        if (kdt === dt && Number(kb) === b) c[cell.basis]++
      }
      return `${blockLabel(b)} ${c.OBSERVED}/${c.SCALED}/${c.DISTANCE}`
    })
    console.log(`  ${dt}  ${line.join('   ')}   (observed/scaled/distance)`)
  }
  let interior = 0
  for (const geo of geometry.values()) if (geo.stops.length > 3) interior += geo.stops.length - 3
  console.log(`  ${interior} interior hops per (day type, block) in TOPOLOGY`)

  console.log('\nHops never reported (likely topology disagreements):')
  for (const [ld, hops] of [...fit.mismatches].sort((a, b) => naturalCompare(a[0], b[0]))) {
    const stops = geometry.get(ld)!.stops
    console.log(`  ${ld.padEnd(7)} ${hops.map(i => `${i}: ${stops[i]} > ${stops[i + 1]}`).join(', ')}`)
  }

  // ── service windows vs service-hours.ts ──
  console.log('\nService windows (first/last stop-1 passing) vs service-hours.ts, where they differ by more than 30 min:')
  for (const [ld, byDay] of [...windows].sort((a, b) => naturalCompare(a[0], b[0]))) {
    const line = ld.replace(/@[FR]$/, '')
    for (const sd of ['WD', 'SAT', 'SUN'] as const) {
      const w = byDay[sd]
      if (!w) continue
      const sched = SERVICE_HOURS[line]?.[sd] ?? SERVICE_HOURS[line]?.ALL
      const schedLabel = sched ? `${hhmm(sched[0])}-${hhmm(sched[1])}` : 'no window (always open)'
      const schedAllDay = !sched || (sched[0] === 0 && sched[1] >= 86_340)
      const obsLabel = w.allDay ? 'all day' : `${w.first !== undefined ? hhmm(w.first) : '?'}-${w.last !== undefined ? hhmm(w.last) : '?'}`
      const differs = w.allDay
        ? !schedAllDay
        : schedAllDay
          || (w.first !== undefined && Math.abs(w.first - sched![0]) > 1800)
          || (w.last !== undefined && Math.abs(w.last - sched![1]) > 1800)
      if (differs) console.log(`  ${ld.padEnd(7)} ${sd.padEnd(3)}  observed ${obsLabel.padEnd(11)} (${w.days} days)  schedule ${schedLabel}`)
    }
  }
  for (const line of Object.keys(SERVICE_HOURS).sort(naturalCompare)) {
    const sched = SERVICE_HOURS[line]!
    for (const sd of ['WD', 'SAT', 'SUN'] as const) {
      if (sched[sd] || (sched.ALL && sd !== 'WD' && sched.WD)) continue
      if (!sched.ALL && !sched[sd]) {
        const seen = ['F', 'R'].some(d => windows.get(`${line}@${d}`)?.[sd])
        if (seen) console.log(`  ${line.padEnd(7)} ${sd.padEnd(3)}  observed running, schedule has no ${sd} window`)
      }
    }
  }

  const text = renderRuntimes({
    fit,
    windows,
    geometry,
    range: { from: days[0]!.day, to: days.at(-1)!.day },
    dayCounts
  })
  if (args['no-write']) {
    console.log(`\n--no-write: ${fit.hops.size} hop cells, ${fit.trips.size} trip cells, ${windows.size} line-direction windows`)
    return
  }
  fs.writeFileSync(args.out!, text)
  console.log(`\nwrote ${args.out} (${fit.hops.size} hop cells, ${fit.trips.size} trip cells, ${windows.size} line-direction windows)`)
  const planner = renderPlannerRuntimes({ fit, bias, geometry, range: { from: days[0]!.day, to: days.at(-1)!.day } })
  fs.writeFileSync(args['planner-out']!, planner)
  console.log(`wrote ${args['planner-out']} (${(planner.length / 1024).toFixed(0)} KiB, ${bias.size} trip-bias buckets)`)
}

void main()
