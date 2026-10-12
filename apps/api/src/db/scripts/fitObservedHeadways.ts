import * as fs from 'node:fs'
import * as path from 'node:path'
import { parseArgs } from 'node:util'
import { DIRECTIONAL_HEADWAYS_S, STOP_HEADWAYS_S } from '../data/headways'
import { TOPOLOGY } from '../data/topology'
import { aggregateDay, AGGREGATE_SCHEMA, type DayAggregate } from './observedHeadways/aggregate'
import { buildOrder } from './observedHeadways/arrivals'
import { backtest, type BacktestSummary, type GtfsLookup, gtfsRawSpec, gtfsScaledSpec, vouchedColumns } from './observedHeadways/backtest'
import { buildPool, columnDayType, columnHour, fitFactorised, fitPooled, fitShrunk, type ModelSpec, pooledCv, SHRINK_KAPPAS } from './observedHeadways/fit'
import { DEFAULT_GATE } from './observedHeadways/health'
import { renderOverlay } from './observedHeadways/render'
import { interpolateProfiles } from './observedHeadways/interpolate'
import { computeColumnScales } from './observedHeadways/scale'
import { dayFiles } from './observedHeadways/snapshots'
import { baseHeadways } from '../../utils/headways'

/*
 * Stage 1 of the observed-headway model: aggregate ward's archives per day
 * (cached), fit the smoothed estimators, backtest them against GTFS, and, if
 * the chosen model beats GTFS, write apps/api/src/db/data/headways.observed.ts.
 *
 *   pnpm --filter api fit:headways --dir <archive dir> [--cache <dir>] [--days N]
 *     [--out <file>] [--no-write] [--force]
 *
 * <dir> is ward's daily archives (see observedHeadways/snapshots.ts). The cache
 * holds one small JSON per day, so a nightly run only reads new archives.
 * Nothing at runtime reads the output yet.
 */

const OUT_PATH = `${__dirname}/../data/headways.observed.ts`
/** M1 must beat M2 by more than this (median |log error|) to be preferred. */
const M1_MARGIN = 0.02

const { values: args } = parseArgs({
  options: {
    'dir': { type: 'string' },
    'cache': { type: 'string' },
    'days': { type: 'string' },
    'out': { type: 'string', default: OUT_PATH },
    'no-write': { type: 'boolean', default: false },
    'force': { type: 'boolean', default: false }
  }
})

const gtfs: GtfsLookup = key => DIRECTIONAL_HEADWAYS_S[key] ?? STOP_HEADWAYS_S[key.replace(/@[FR]$/, '')]

async function loadDays(dir: string, cacheDir: string, limit?: number): Promise<DayAggregate[]> {
  fs.mkdirSync(cacheDir, { recursive: true })
  const order = buildOrder(TOPOLOGY)
  const all = dayFiles(dir)
  const wanted = limit ? all.slice(-limit) : all
  const out: DayAggregate[] = []
  for (const { day, files } of wanted) {
    const source = files.map(f => ({ file: path.basename(f), size: fs.statSync(f).size }))
    const cachePath = path.join(cacheDir, `day-${day}.json`)
    if (fs.existsSync(cachePath)) {
      const cached = JSON.parse(fs.readFileSync(cachePath, 'utf8')) as { source: typeof source, aggregate: DayAggregate }
      if (cached.aggregate.schema === AGGREGATE_SCHEMA && JSON.stringify(cached.source) === JSON.stringify(source)) {
        out.push(cached.aggregate)
        continue
      }
    }
    console.log(`aggregating ${day} (${files.length} file${files.length === 1 ? '' : 's'})`)
    const aggregate = await aggregateDay(day, files, order, DEFAULT_GATE)
    fs.writeFileSync(cachePath, JSON.stringify({ source, aggregate }))
    out.push(aggregate)
  }
  return out
}

const fmt = (n: number) => Number.isFinite(n) ? n.toFixed(3) : '  -  '

function printSummary(title: string, s: BacktestSummary, names: string[]) {
  console.log(`\n${title}: ${s.folds} folds, ${s.truthBuckets} truth buckets, ${s.intersection} in the all-model intersection`)
  console.log(`  ${'model'.padEnd(12)} median     p75  coverage`)
  for (const name of names) {
    const m = s.models[name]!
    console.log(`  ${name.padEnd(12)} ${fmt(m.median)}  ${fmt(m.p75)}  ${(100 * m.coverage).toFixed(0).padStart(5)}%`)
  }
}

async function main() {
  if (!args.dir) throw new Error('--dir <archive dir> is required')
  const cacheDir = args.cache ?? path.join(args.dir, '.fit-cache')
  const days = await loadDays(args.dir, cacheDir, args.days ? Number(args.days) : undefined)
  if (days.length === 0) throw new Error(`no snapshot files in ${args.dir}`)

  const count = (type: 'WD' | 'WE') => days.filter(d => d.dayType === type).length
  console.log(`${days.length} days ${days[0]!.day}..${days.at(-1)!.day} (${count('WD')} weekday, ${count('WE')} weekend)`)

  const specs: ModelSpec[] = [
    gtfsRawSpec(gtfs),
    gtfsScaledSpec(gtfs),
    { name: 'M0 pooled', fit: fitPooled },
    ...SHRINK_KAPPAS.map(k => ({ name: `M1 k=${k}`, fit: (pool: Parameters<typeof fitPooled>[0]) => fitShrunk(pool, k) })),
    { name: 'M2 factor', fit: fitFactorised }
  ]
  const names = specs.map(s => s.name)

  const loo = backtest(days, specs, gtfs, 'loo')
  const looWd = backtest(days, specs, gtfs, 'loo', 'WD')
  const looWe = backtest(days, specs, gtfs, 'loo', 'WE')
  const rolling = backtest(days, specs, gtfs, 'rolling')
  printSummary('leave-one-day-out, all days', loo, names)
  printSummary('leave-one-day-out, weekday folds', looWd, names)
  printSummary(`leave-one-day-out, weekend folds (${count('WE')} days: low confidence)`, looWe, names)
  printSummary('rolling next-day', rolling, names)

  const vouched = vouchedColumns(loo, 'M2 factor', 'gtfsScaled')
  console.log('\nper-column median error, all-days LOO (M2 vs GTFS scaled); * = vouched, shipped:')
  for (const c of Object.keys(loo.byColumn).map(Number).sort((a, b) => a - b)) {
    const row = loo.byColumn[c]!
    const mark = vouched.has(c) ? '*' : ' '
    console.log(`  ${mark} ${columnDayType(c)} ${String(columnHour(c)).padStart(2)}  n=${String(row.n).padStart(5)}  M2 ${fmt(row.median['M2 factor']!)}  gtfsScaled ${fmt(row.median.gtfsScaled!)}`)
  }

  // ── choose and gate ────────────────────────────────────────────────────────
  const m2 = loo.models['M2 factor']!
  const bestShrink = SHRINK_KAPPAS.map(k => ({ k, ...loo.models[`M1 k=${k}`]! })).sort((a, b) => a.median - b.median)[0]!
  const shrinkWins = bestShrink.median < m2.median - M1_MARGIN
  const baseline = loo.models.gtfsScaled!
  const beatsGtfs = m2.median < baseline.median
  console.log(`\nchosen: ${shrinkWins ? `M1 k=${bestShrink.k}` : 'M2 factor'}; M2 ${fmt(m2.median)} vs GTFS scaled ${fmt(baseline.median)} (beats: ${beatsGtfs})`)

  const pool = buildPool(days)
  fs.writeFileSync(path.join(cacheDir, 'fit-report.json'), JSON.stringify({
    days: days.map(d => d.day),
    backtests: { loo, looWd, looWe, rolling },
    cv: Object.fromEntries(pooledCv(pool))
  }))

  if (shrinkWins) {
    console.error('M1 beats M2 by more than the margin, but the overlay format only carries M2. Not writing; revisit the format.')
    process.exitCode = 1
    return
  }
  if (!beatsGtfs && !args.force) {
    console.error('M2 does not beat GTFS scaled in the backtest. Not writing (use --force to override).')
    process.exitCode = 1
    return
  }
  if (args['no-write']) return

  const model = fitFactorised(pool)
  // The base is exactly what the planner would use for the day, so the scale
  // multiplies the same numbers it was measured against.
  const scales = computeColumnScales(model, vouched, (day, key) => baseHeadways(day).get(key))
  // Only the cells that ship are measured; interpolation fills between those.
  // The model's profile is a rate (arrivals per second at an average stop);
  // interpolation is done in headway seconds, which is what ships.
  const measured = new Map(
    [...model.profile]
      .filter(([id]) => vouched.has(Number(id.split('|')[1])))
      .map(([id, perSecond]) => [id, 1 / perSecond] as const)
  )
  const interpolated = interpolateProfiles(measured)
  const summary = (label: string, s: BacktestSummary) =>
    `${label}: M2 ${fmt(s.models['M2 factor']!.median)}, pooled ${fmt(s.models['M0 pooled']!.median)}, GTFS scaled ${fmt(s.models.gtfsScaled!.median)}, GTFS raw ${fmt(s.models.gtfsRaw!.median)} (median |log err|, ${s.intersection} buckets)`
  const text = renderOverlay({
    model,
    pool,
    modelName: 'M2 factorised',
    range: { from: days[0]!.day, to: days.at(-1)!.day },
    dayCounts: { WD: count('WD'), WE: count('WE') },
    vouched,
    scales,
    interpolated,
    backtestLines: [summary('Leave-one-day-out', loo), summary('Rolling next-day', rolling)]
  })
  fs.writeFileSync(args.out!, text)
  const shipped = [...model.profile.keys()].filter(id => vouched.has(Number(id.split('|')[1]))).length
  console.log(`wrote ${args.out} (${shipped} of ${model.profile.size} profile cells vouched, ${model.factor.size} stop factors, ${scales.filter(s => s.measured).length}/${scales.length} scale columns measured, ${interpolated.size} interpolated profile cells)`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
