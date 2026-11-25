import { parseArgs } from 'node:util'
import { SERVICE_HOURS, type ServiceDay } from '../data/service-hours'
import { TOPOLOGY } from '../data/topology'
import { estimateTjLeg, blockAt } from '../../utils/observedRuntimes'
import { plannerHeadways } from '../../utils/observedHeadways'
import { expectedWaitS } from '../../utils/tjWaits'
import { dayTypeOf, serviceDayOf } from './observedHeadways/aggregate'
import { buildOrder, DEFAULT_ARRIVAL_OPTIONS, extractPassings } from './observedHeadways/arrivals'
import { SnapshotCollector } from './observedHeadways/collector'
import { RUNTIME_BLOCKS, blockLabel } from './observedHeadways/dayTrips'
import { DEFAULT_GATE, intervals } from './observedHeadways/health'
import { arriveByBudgetS, fillHoles, replay, type StopPassings, type TripTimes } from './observedHeadways/lateness'
import { dayFiles, lines, type SnapshotRecord } from './observedHeadways/snapshots'
import { splitTrips } from './observedHeadways/trips'
import type { ServiceWindow } from '@commute/tsundere'

/*
 * Arrive-by lateness backtest for TransJakarta legs (docs/arrive-by.md,
 * "Lateness backtest"). Builds nothing: it reports how often each wait + ride
 * budget would have made a rider late, against the buses ward actually saw.
 *
 *   pnpm --filter api analyze:arrive-by --dir <archive dir> [--days N]
 *
 * For every line-direction, up to BOARDS_PER_LD boarding stops × SPANS stops of
 * ride, and a rider reaching the boarding stop every STEP_MIN minutes, it
 * replays the first real bus that reaches the alighting stop
 * (observedHeadways/lateness.ts) and scores the planner's own estimators for
 * that moment against it. Re-run after every `fit:tj-runtimes`: the budget
 * leans on those run times.
 *
 * Single-line replay: on a shared stretch a rider could also board an
 * interlining line, so wait is scored against the boarded line's own model, not
 * the pooled one. Conservative there. Reads the raw snapshots directly (the
 * dayTrips cache keeps aggregates only, not per-trip passings), ~2 min for 15
 * days. Needs `zstd` on PATH for .zst archives, like every observedHeadways
 * reader.
 */

const { values: args } = parseArgs({
  options: {
    dir: { type: 'string' },
    days: { type: 'string' }
  }
})

const STEP_MIN = 10
const SPANS = [3, 8, 15]
const BOARDS_PER_LD = 6
const FROM_H = 4
const TO_H = 23
const REPLAY = { maxWaitMs: 2 * 3600_000, activeWithinMs: 3600_000 }
/** A sample is dropped when the collector was unhealthy anywhere from this long before the rider arrives until they alight. */
const HEALTH_LEAD_MS = 15 * 60_000

interface Sample {
  dt: 'WD' | 'WE'
  block: number
  line: string
  span: number
  /** Planner headway at the boarding stop, s. */
  h: number
  actual: number
  wait: number
  ride: number
  /** Bunched expected wait, s (single line). */
  ew: number
  rideMedian: number
  rideP75: number
}

const serviceHoursCache = new Map<ServiceDay, Map<string, ServiceWindow>>()
function serviceHoursFor(day: ServiceDay): Map<string, ServiceWindow> {
  let resolved = serviceHoursCache.get(day)
  if (!resolved) {
    resolved = new Map()
    // Same resolution as fares.ts serviceHoursMap: the specific day, then ALL.
    for (const [line, byDay] of Object.entries(SERVICE_HOURS)) {
      const window = byDay[day] ?? byDay.ALL
      if (window) resolved.set(line, window)
    }
    serviceHoursCache.set(day, resolved)
  }
  return resolved
}

const headwayCache = new Map<string, Map<string, number>>()
function headwaysAt(day: ServiceDay, hour: number): Map<string, number> {
  const key = `${day}|${hour}`
  let headways = headwayCache.get(key)
  if (!headways) headwayCache.set(key, headways = plannerHeadways(day, hour, true))
  return headways
}

const quantile = (xs: readonly number[], p: number) => {
  if (xs.length === 0) return NaN
  const sorted = [...xs].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]!
}
const pct = (xs: readonly Sample[], late: (s: Sample) => boolean) =>
  (100 * xs.filter(late).length / xs.length).toFixed(1).padStart(5)
const ratio = (x: number) => x.toFixed(2).padStart(5)
const minutes = (s: number) => (s / 60).toFixed(1).padStart(5)

const e50 = (s: Sample) => s.ew + s.rideMedian
const e75 = (s: Sample) => s.ew + s.rideP75
const hP75 = (s: Sample) => s.h + s.rideP75
const decided = (s: Sample) => arriveByBudgetS(s.h, s.rideP75)

async function main() {
  if (!args.dir) throw new Error('--dir <archive dir> is required')
  const order = buildOrder(TOPOLOGY)
  const all = dayFiles(args.dir)
  const wanted = args.days ? all.slice(-Number(args.days)) : all
  if (wanted.length === 0) throw new Error(`no snapshot files in ${args.dir}`)

  const samples: Sample[] = []
  const skipped = { inactive: 0, noBus: 0, unhealthy: 0, noEstimate: 0, shortTurns: 0 }
  const holes = { through: 0, missing: 0, filled: 0 }
  const estimates = new Map<string, Pick<Sample, 'h' | 'ew' | 'rideMedian' | 'rideP75'> | null>()

  for (const { day, files } of wanted) {
    const started = Date.now()
    const collector = new SnapshotCollector(new Set(order.keys()), DEFAULT_GATE)
    for (const file of files) {
      for await (const line of lines(file)) if (line) collector.add(JSON.parse(line) as SnapshotRecord)
    }
    const unhealthy = intervals(collector.gaps).merged
    const overlapsGap = (from: number, to: number) =>
      from < collector.t0 || to > collector.t1 || unhealthy.some(([x, y]) => x < to && y > from)

    // `${line}@${dir}` -> stop index -> every trip's passing there, by time.
    const byLineDir = new Map<string, Map<number, StopPassings>>()
    for (const list of collector.series.values()) {
      for (const trip of splitTrips(extractPassings(list, order, DEFAULT_ARRIVAL_OPTIONS))) {
        const at: TripTimes = new Map()
        for (const p of trip.passings) if (!at.has(p.index)) at.set(p.index, p.t)
        holes.filled += fillHoles(at)
        const ld = `${trip.route}@${trip.dir}`
        let stops = byLineDir.get(ld)
        if (!stops) byLineDir.set(ld, stops = new Map())
        for (const [index, t] of at) {
          let passings = stops.get(index)
          if (!passings) stops.set(index, passings = [])
          passings.push({ t, at })
        }
      }
    }
    for (const stops of byLineDir.values()) for (const passings of stops.values()) passings.sort((a, b) => a.t - b.t)

    const serviceDay = serviceDayOf(day)
    const dayType = dayTypeOf(day)
    const midnight = Date.parse(`${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6, 8)}T00:00:00+07:00`)

    for (const [ld, stops] of byLineDir) {
      const [lineCode, dir] = ld.split('@') as [string, 'F' | 'R']
      const codes = [...order.get(lineCode)![dir]].sort((a, b) => a[1] - b[1]).map(([station]) => station)
      const tripsHere = new Set<TripTimes>()
      for (const passings of stops.values()) for (const p of passings) tripsHere.add(p.at)

      for (const span of SPANS) {
        // Interior stops only: stop 0 carries the layover, the last hop is never seen.
        const lastBoard = codes.length - 2 - span
        if (lastBoard < 1) continue
        const boards = [...new Set(Array.from({ length: BOARDS_PER_LD }, (_, k) =>
          1 + Math.round(k * (lastBoard - 1) / Math.max(1, BOARDS_PER_LD - 1))))]

        for (const board of boards) {
          const alight = board + span
          // Holes left after filling: buses seen on both sides of the leg with no passing at one end.
          for (const at of tripsHere) {
            let before = false, after = false
            for (const index of at.keys()) {
              if (index < board) before = true
              if (index > alight) after = true
            }
            if (before && after) {
              holes.through++
              if (!at.has(board) || !at.has(alight)) holes.missing++
            }
          }

          const atBoard = stops.get(board)
          if (!atBoard || atBoard.length < 3) continue
          const stationIds = codes.slice(board, alight + 1).map(code => `TJ-${code}`)
          const leg = { type: 'RIDE' as const, lineCode, operator: 'TJ', fromStationId: stationIds[0]!, toStationId: stationIds.at(-1)!, stationIds, distanceM: 0 }

          for (let minute = FROM_H * 60; minute < TO_H * 60; minute += STEP_MIN) {
            const t = midnight + minute * 60_000
            const result = replay(atBoard, t, alight, REPLAY)
            if (result.kind === 'inactive') {
              skipped.inactive++
              continue
            }
            skipped.shortTurns += result.skipped
            if (result.kind === 'noBus') {
              skipped.noBus++
              continue
            }
            if (overlapsGap(t - HEALTH_LEAD_MS, result.alightT)) {
              skipped.unhealthy++
              continue
            }

            const clockS = minute * 60
            const key = `${ld}|${board}|${alight}|${serviceDay}|${minute}`
            let estimate = estimates.get(key)
            if (estimate === undefined) {
              const headways = headwaysAt(serviceDay, Math.floor(minute / 60))
              const inputs = { day: serviceDay, headways, serviceHours: serviceHoursFor(serviceDay), observed: true }
              const median = estimateTjLeg(leg, clockS, inputs)
              const p75 = estimateTjLeg(leg, clockS, { ...inputs, statistic: 'p75' })
              const ew = expectedWaitS([lineCode], leg.fromStationId, stationIds[1]!, { day: serviceDay, clockS, headways, observed: true })
              const h = headways.get(`${lineCode}@${leg.fromStationId}`) ?? headways.get(lineCode)
              estimate = median && p75 && ew !== undefined && h ? { h, ew, rideMedian: median.rideS, rideP75: p75.rideS } : null
              estimates.set(key, estimate)
            }
            if (!estimate) {
              skipped.noEstimate++
              continue
            }
            samples.push({
              dt: dayType,
              block: blockAt(clockS),
              line: lineCode,
              span,
              ...estimate,
              actual: (result.alightT - t) / 1000,
              wait: (result.boardT - t) / 1000,
              ride: (result.alightT - result.boardT) / 1000
            })
          }
        }
      }
    }
    console.error(`${day} ${serviceDay}: ${samples.length} samples so far (${((Date.now() - started) / 1000).toFixed(0)}s)`)
  }

  report(samples, skipped, holes)
}

function report(
  samples: readonly Sample[],
  skipped: Record<string, number>,
  holes: { through: number, missing: number, filled: number }
) {
  console.log(`${samples.length} samples; skipped`, skipped)
  console.log(`${holes.filled} passings interpolated; ${holes.missing} of ${holes.through} buses driving through a leg still lack its board or alight stop (${(100 * holes.missing / holes.through).toFixed(2)}%)`)

  console.log('\nLate rate, % of rider arrival times where the real trip took longer than the budget')
  console.log('  E50 = bunched wait + median ride (what /trips estimates today); E75 = bunched wait + p75 ride')
  console.log('  H75 = 1 headway + p75 ride; ARR = arriveByBudgetS (1.5h, or 1h at 20+ min, + p75 ride)')
  console.log('  ratio = actual / E50 quantiles; +min = minutes over E50 to be on time at p90 / p95\n')
  console.log('dt  block        n    E50   E75   H75   ARR | r.p50 r.p75 r.p90 r.p95 |  +p90  +p95 | wait>h')
  for (const dt of ['WD', 'WE'] as const) {
    const groups: [string, Sample[]][] = RUNTIME_BLOCKS.map((_, b) => [blockLabel(b), samples.filter(s => s.dt === dt && s.block === b)])
    groups.push(['all  ', samples.filter(s => s.dt === dt)])
    for (const [label, xs] of groups) {
      if (xs.length < 200) continue
      const r = xs.map(s => s.actual / e50(s)), over = xs.map(s => s.actual - e50(s))
      console.log(`${dt}  ${label} ${String(xs.length).padStart(8)} ${pct(xs, s => s.actual > e50(s))} ${pct(xs, s => s.actual > e75(s))} ${pct(xs, s => s.actual > hP75(s))} ${pct(xs, s => s.actual > decided(s))} | ${ratio(quantile(r, 0.5))} ${ratio(quantile(r, 0.75))} ${ratio(quantile(r, 0.9))} ${ratio(quantile(r, 0.95))} | ${minutes(quantile(over, 0.9))} ${minutes(quantile(over, 0.95))} | ${pct(xs, s => s.wait > s.h)}`)
    }
  }

  console.log('\nWhich part goes wrong (actual minus model, minutes, p50 / p90)')
  console.log(`  wait - bunched expected: ${minutes(quantile(samples.map(s => s.wait - s.ew), 0.5))} / ${minutes(quantile(samples.map(s => s.wait - s.ew), 0.9))}`)
  console.log(`  ride - median ride     : ${minutes(quantile(samples.map(s => s.ride - s.rideMedian), 0.5))} / ${minutes(quantile(samples.map(s => s.ride - s.rideMedian), 0.9))}`)

  const candidates: [string, (s: Sample) => number][] = [
    ['E50 (today)', e50],
    ['h + p75', hP75],
    ['1.5h + p75', s => 1.5 * s.h + s.rideP75],
    ['2h + p75', s => 2 * s.h + s.rideP75],
    ['2h + 1.15*p75', s => 2 * s.h + 1.15 * s.rideP75],
    ['arriveByBudgetS', decided]
  ]
  const slices: [string, (s: Sample) => boolean][] = [
    ['all', () => true],
    ['WD 07-10', s => s.dt === 'WD' && s.block === 2],
    ['WD 16-20', s => s.dt === 'WD' && s.block === 4],
    ['WE 10-16', s => s.dt === 'WE' && s.block === 3],
    ...SPANS.map((span): [string, (s: Sample) => boolean] => [`${span} stops`, s => s.span === span]),
    ['h<10', s => s.h < 600],
    ['h 10-20', s => s.h >= 600 && s.h < 1200],
    ['h>=20', s => s.h >= 1200]
  ]
  console.log('\nCandidate budgets: late % and median minutes early')
  console.log('budget'.padEnd(18) + slices.map(([label]) => label.padStart(14)).join(''))
  for (const [name, budget] of candidates) {
    const cells = slices.map(([, select]) => {
      const xs = samples.filter(select)
      if (xs.length === 0) return '-'.padStart(14)
      const late = 100 * xs.filter(s => s.actual > budget(s)).length / xs.length
      const early = quantile(xs.map(s => budget(s) - s.actual), 0.5) / 60
      return `${late.toFixed(1)}% ${early.toFixed(1)}m`.padStart(14)
    })
    console.log(name.padEnd(18) + cells.join(''))
  }

  const byLine = new Map<string, Sample[]>()
  for (const s of samples) {
    let xs = byLine.get(s.line)
    if (!xs) byLine.set(s.line, xs = [])
    xs.push(s)
  }
  const rows = [...byLine]
    .filter(([, xs]) => xs.length >= 500)
    .map(([line, xs]) => ({ line, n: xs.length, late: xs.filter(s => s.actual > decided(s)).length / xs.length }))
    .sort((a, b) => b.late - a.late)
  console.log('\nLines latest under arriveByBudgetS (>= 500 samples)')
  for (const row of rows.slice(0, 12)) console.log(`  ${row.line.padEnd(6)} ${String(row.n).padStart(6)}  ${(row.late * 100).toFixed(1)}%`)
  console.log(`  ... ${rows.length} lines; median line ${(100 * quantile(rows.map(r => r.late), 0.5)).toFixed(1)}%`)
}

void main()
