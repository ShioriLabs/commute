import * as fs from 'node:fs'
import * as path from 'node:path'
import { parseArgs } from 'node:util'
import { DIRECTIONAL_HEADWAYS_S, STOP_HEADWAYS_S } from '../data/headways'
import { TOPOLOGY } from '../data/topology'
import { aggregateDay, AGGREGATE_SCHEMA, aggregationFingerprint, dayTypeOf, type DayAggregate } from './observedHeadways/aggregate'
import { buildOrder } from './observedHeadways/arrivals'
import { backtest, type BacktestSummary, type GtfsLookup, gtfsRawSpec, gtfsScaledSpec, vouchedColumns } from './observedHeadways/backtest'
import { buildPool, COLUMNS, columnDayType, columnHour, fitFactorised, MIN_COLUMN_DAYS, fitPooled, fitShrunk, type ModelSpec, pooledCv, SHRINK_KAPPAS } from './observedHeadways/fit'
import { DEFAULT_GATE } from './observedHeadways/health'
import { renderOverlay } from './observedHeadways/render'
import { CELL_VETO, CONFLICT_TOLERANCE, interpolateProfiles, rejectConflicting } from './observedHeadways/interpolate'
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
 * The runtime reads the output through utils/observedHeadways.ts (the planner
 * and the station headway endpoint); see docs/adr/ward-collector.md.
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
  const fingerprint = aggregationFingerprint(order, DEFAULT_GATE)
  const all = dayFiles(dir)
  const wanted = limit ? all.slice(-limit) : all
  const out: DayAggregate[] = []
  for (const { day, files } of wanted) {
    const source = files.map(f => ({ file: path.basename(f), size: fs.statSync(f).size }))
    const cachePath = path.join(cacheDir, `day-${day}.json`)
    if (fs.existsSync(cachePath)) {
      const cached = JSON.parse(fs.readFileSync(cachePath, 'utf8')) as {
        source: typeof source
        fingerprint?: string
        aggregate: DayAggregate
      }
      const same = cached.aggregate.schema === AGGREGATE_SCHEMA
        && cached.fingerprint === fingerprint
        && JSON.stringify(cached.source) === JSON.stringify(source)
      if (same) {
        // The day type is recomputed, not trusted: a holiday list that gained a
        // date since the aggregate was written must move that day to WE.
        out.push({ ...cached.aggregate, dayType: dayTypeOf(day) })
        continue
      }
    }
    console.log(`aggregating ${day} (${files.length} file${files.length === 1 ? '' : 's'})`)
    const aggregate = await aggregateDay(day, files, order, DEFAULT_GATE)
    fs.writeFileSync(cachePath, JSON.stringify({ source, fingerprint, aggregate }))
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

  // What ships is M2, judged against the scaled schedule over every bucket BOTH
  // predicted, so a column vouches on the stops it will actually be applied to.
  const focus = { model: 'M2 factor', baseline: 'gtfsScaled' }
  const loo = backtest(days, specs, gtfs, 'loo', undefined, focus)
  const looWd = backtest(days, specs, gtfs, 'loo', 'WD', focus)
  const looWe = backtest(days, specs, gtfs, 'loo', 'WE', focus)
  const rolling = backtest(days, specs, gtfs, 'rolling', undefined, focus)
  printSummary('leave-one-day-out, all days', loo, names)
  printSummary('leave-one-day-out, weekday folds', looWd, names)
  printSummary(`leave-one-day-out, weekend folds (${count('WE')} days: low confidence)`, looWe, names)
  printSummary('rolling next-day', rolling, names)

  const vouched = vouchedColumns(loo, focus.model, focus.baseline)
  console.log('\nper-column median error, all-days LOO (M2 vs GTFS scaled, buckets both predicted); * = vouched, shipped:')
  for (const c of Object.keys(loo.pair ?? {}).map(Number).sort((a, b) => a - b)) {
    const row = loo.pair![c]!
    const mark = vouched.has(c) ? '*' : ' '
    console.log(`  ${mark} ${columnDayType(c)} ${String(columnHour(c)).padStart(2)}  n=${String(row.n).padStart(5)}  M2 ${fmt(row.model)}  gtfsScaled ${fmt(row.baseline)}`)
  }

  // ── choose and gate ────────────────────────────────────────────────────────
  const m2 = loo.models['M2 factor']!
  // The best key-hour model: pooled (M0) or any shrinkage (M1). The overlay
  // format only carries M2, so a clear winner here means "revisit the format".
  const keyHour = [
    { name: 'M0 pooled', ...loo.models['M0 pooled']! },
    ...SHRINK_KAPPAS.map(k => ({ name: `M1 k=${k}`, ...loo.models[`M1 k=${k}`]! }))
  ].sort((a, b) => a.median - b.median)[0]!
  const keyHourWins = keyHour.median < m2.median - M1_MARGIN
  const baseline = loo.models.gtfsScaled!
  const beatsGtfs = m2.median < baseline.median
  console.log(`\nchosen: ${keyHourWins ? keyHour.name : 'M2 factor'}; M2 ${fmt(m2.median)} vs best key-hour ${keyHour.name} ${fmt(keyHour.median)} (margin ${M1_MARGIN}) vs GTFS scaled ${fmt(baseline.median)} (beats: ${beatsGtfs})`)

  const pool = buildPool(days)
  fs.writeFileSync(path.join(cacheDir, 'fit-report.json'), JSON.stringify({
    days: days.map(d => d.day),
    backtests: { loo, looWd, looWe, rolling },
    cv: Object.fromEntries(pooledCv(pool))
  }))

  if (keyHourWins) {
    console.error(`${keyHour.name} beats M2 by more than the margin, but the overlay format only carries M2. Not writing; revisit the format.`)
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
  // The base is exactly what the planner would use for the day, so each scale
  // multiplies the same kind of number it was measured against.
  const scales = computeColumnScales(
    model,
    (day, key) => baseHeadways(day).get(key),
    key => DIRECTIONAL_HEADWAYS_S[key],
    vouched
  )
  // The model's profile is a rate (arrivals per second at an average stop);
  // everything below works in headway seconds, which is what ships.
  const own = new Map([...model.profile].map(([id, perSecond]) => [id, 1 / perSecond] as const))
  // Only the cells that ship are measured; interpolation fills between those,
  // and is then checked against what the model itself saw in the hours it fills.
  const measured = new Map([...own].filter(([id]) => vouched.has(Number(id.split('|')[1]))))
  // Columns with enough healthy days to fit a profile: a line-direction missing
  // from one of them barely ran, which is not the same as a blind hour.
  const dataColumns = new Set(
    Array.from({ length: COLUMNS }, (_, c) => c).filter(c => pool.daysOk[c]! >= MIN_COLUMN_DAYS)
  )
  const { accepted: interpolated, rejectedColumns, deviations, vetoedCells, sparseVetoed } = rejectConflicting(
    interpolateProfiles(measured),
    own,
    vouched,
    dataColumns
  )
  // Show every column's margin, so a borderline one is visible to whoever reviews
  // the refit rather than discovered when it flips.
  console.log(`\ninterpolation vs the model's own values (median |log|; tolerance ${CONFLICT_TOLERANCE.toFixed(2)}, cell veto ${CELL_VETO.toFixed(2)}):`)
  for (const [c, deviation] of [...deviations].sort(([a], [b]) => a - b)) {
    const margin = CONFLICT_TOLERANCE - deviation
    const state = rejectedColumns.includes(c) ? 'rejected' : 'kept'
    const flag = Math.abs(margin) < 0.05 ? '  <- borderline' : ''
    console.log(`  ${columnDayType(c)} ${String(columnHour(c)).padStart(2)}  ${deviation.toFixed(2)}  ${state}${flag}`)
  }
  console.log(`rejected (own failure or sharing a span with one): ${rejectedColumns.map(c => `${columnDayType(c)}:${columnHour(c)}`).join(' ') || 'none'}; ${vetoedCells} cells vetoed, ${sparseVetoed} sparse (observed column, line-direction barely ran)`)
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
    rejectedColumns,
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
