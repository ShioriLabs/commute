import { parseArgs } from 'node:util'
import { TOPOLOGY } from '../data/topology'
import { DIRECTIONAL_HEADWAYS_S, STOP_HEADWAYS_S } from '../data/headways'
import { buildOrder, extractArrivals } from './observedHeadways/arrivals'
import { SnapshotCollector } from './observedHeadways/collector'
import { DEFAULT_GATE, type HealthGate, intervals, wibHour } from './observedHeadways/health'
import { type Dir, inputFiles, lines, type SnapshotRecord } from './observedHeadways/snapshots'

/*
 * Observed TJ headways from ward's snapshots (apps/ward, docs/adr/ward-collector.md),
 * compared against the GTFS-derived values in headways.ts.
 *
 *   pnpm --filter api analyze:headways --dir <dir> [--days 30] [--hours 17-19]
 *     [--lines 1,9] [--healthy-min 400] [--no-interpolate] [--max-obs-gap-ms 300000]
 *
 * <dir> holds ward's daily archives and/or hourly files (see
 * observedHeadways/snapshots.ts). Extraction, the health gate and the
 * arrival rules live in observedHeadways/ and are shared with
 * fitObservedHeadways.ts; this script is the one-window report.
 *
 * Method (settled during the 2026-09-29 spike):
 *   - An arrival at stop A is a bus's `next_stops` changing from A to B
 *     between two observations. Stops passed between two observations (the bus
 *     went A -> C inside one ~30s interval) are credited with interpolated times
 *     (--no-interpolate turns that off; it would wrongly credit express
 *     variants with haltes they skip).
 *   - Direction comes from the stop order along the line's path/pathReverse.
 *   - Observations further apart than --max-obs-gap-ms don't bound an arrival
 *     tightly enough to keep. A bus standing at a halte stops sending updates
 *     for minutes, so this has to be generous; 2 min dropped half of K1.
 *   - The relay can send snapshots whose positions are stale. A snapshot is
 *     healthy when at least half the in-scope buses that are running updated
 *     since the previous one (--healthy-min N switches to the old fixed count
 *     of N fresh buses, which undercounts nights and weekends). Unhealthy
 *     stretches count as gaps, and so does any silence over 90s between
 *     snapshots (collector restarts, missing days).
 *   - Headway = healthy time / arrivals inside healthy time (a rate). The
 *     mean of consecutive gaps is also shown, but it is biased short when
 *     healthy windows are brief: a long headway is the one most likely to
 *     straddle a gap and get dropped.
 */

const HEALTHY_STEP_MS = 10_000

const { values: args } = parseArgs({
  options: {
    'dir': { type: 'string' },
    'days': { type: 'string' },
    'hours': { type: 'string', default: '0-24' },
    'lines': { type: 'string', default: '1,10H' },
    'healthy-min': { type: 'string' },
    'max-obs-gap-ms': { type: 'string', default: '300000' },
    'no-interpolate': { type: 'boolean', default: false }
  }
})

const GATE: HealthGate = args['healthy-min'] === undefined
  ? DEFAULT_GATE
  : { kind: 'count', min: Number(args['healthy-min']) }
const GATE_LABEL = GATE.kind === 'count'
  ? `HEALTHY_MIN=${GATE.min}`
  : `fresh share >= ${GATE.minShare}`
const MAX_OBS_GAP_MS = Number(args['max-obs-gap-ms'])
const INTERPOLATE = !args['no-interpolate']
const [HOUR_FROM, HOUR_TO] = args.hours!.split('-').map(Number) as [number, number]
const FOCUS = args.lines!.split(',').filter(Boolean)

const inHours = (t: number) => wibHour(t) >= HOUR_FROM && wibHour(t) < HOUR_TO

async function main() {
  if (!args.dir) throw new Error('--dir <dir> is required')
  const files = inputFiles(args.dir, args.days ? Number(args.days) : undefined)
  if (files.length === 0) throw new Error(`no snapshot files in ${args.dir}`)

  const order = buildOrder(TOPOLOGY)

  // ── stream snapshots → per-vehicle series, deduped on the relay's update time ──
  const collector = new SnapshotCollector(new Set(order.keys()), GATE)
  for (const file of files) {
    for await (const line of lines(file)) {
      if (line) collector.add(JSON.parse(line) as SnapshotRecord)
    }
  }
  const { t0, t1, snapCount, degradedSnaps } = collector
  const unhealthy = intervals(collector.gaps)

  // ── transitions → arrivals ─────────────────────────────────────────────────
  const { arrivals, stats } = extractArrivals(collector.series.values(), order, {
    maxObsGapMs: MAX_OBS_GAP_MS,
    interpolate: INTERPOLATE,
    keep: inHours
  })

  // ── per (line, stop, dir) metrics ─────────────────────────────────────────────
  let healthyMs = 0
  for (let t = t0; t < t1; t += HEALTHY_STEP_MS) if (inHours(t) && !unhealthy.contains(t)) healthyMs += HEALTHY_STEP_MS

  type Row = { key: string, n: number, mean: number, wait: number, cv: number, rateH: number, gtfs?: number }
  const rows: Row[] = []
  for (const [key, times] of arrivals) {
    times.sort((x, y) => x - y)
    const hs: number[] = []
    for (let i = 1; i < times.length; i++) {
      if (!unhealthy.overlaps(times[i - 1]!, times[i]!)) hs.push((times[i]! - times[i - 1]!) / 1000)
    }
    const nHealthy = times.filter(t => !unhealthy.contains(t)).length
    if (hs.length < 3 || nHealthy < 3) continue
    const sum = hs.reduce((a, b) => a + b, 0)
    const sum2 = hs.reduce((a, b) => a + b * b, 0)
    const mean = sum / hs.length
    const sd = Math.sqrt(Math.max(0, sum2 / hs.length - mean * mean))
    rows.push({
      key,
      n: times.length,
      mean,
      wait: sum2 / (2 * sum),
      cv: sd / mean,
      rateH: healthyMs / 1000 / nHealthy,
      gtfs: DIRECTIONAL_HEADWAYS_S[key] ?? STOP_HEADWAYS_S[key.replace(/@[FR]$/, '')]
    })
  }

  // ── report ───────────────────────────────────────────────────────────────────
  const fmt = (t: number) => new Date(t).toLocaleString('en-GB', { timeZone: 'Asia/Jakarta' })
  const q = (a: number[], p: number) => a[Math.floor(p * (a.length - 1))] ?? NaN
  const dist = (a: number[]) => {
    const s = [...a].sort((x, y) => x - y)
    return `p10 ${q(s, 0.1).toFixed(2)}  p50 ${q(s, 0.5).toFixed(2)}  p90 ${q(s, 0.9).toFixed(2)}`
  }
  const spanMin = (t1 - t0) / 60000
  console.log(`${files.length} files, ${fmt(t0)} → ${fmt(t1)}, ${snapCount} snapshots (${degradedSnaps} degraded at ${GATE_LABEL})`)
  console.log(`hours ${HOUR_FROM}-${HOUR_TO} WIB: healthy ${(healthyMs / 60000).toFixed(0)} min of ${spanMin.toFixed(0)}; ${unhealthy.merged.length} unhealthy stretches`)
  console.log('transitions', stats, `adjacent share ${((100 * stats.adjacent) / Math.max(1, stats.adjacent + stats.jump)).toFixed(0)}%`)

  const withGtfs = rows.filter(r => r.gtfs !== undefined && r.n >= 6)
  console.log(`\n(line, stop, dir) with a GTFS value and ≥6 arrivals: ${withGtfs.length}`)
  console.log(`  rate headway / GTFS:                ${dist(withGtfs.map(r => r.rateH / r.gtfs!))}`)
  console.log(`  rate wait h(1+CV²)/2 / (GTFS/2):    ${dist(withGtfs.map(r => (r.rateH * (1 + r.cv * r.cv)) / r.gtfs!))}`)
  console.log(`  mean-of-gaps headway / GTFS (low):  ${dist(withGtfs.map(r => r.mean / r.gtfs!))}`)
  console.log(`  headway CV:                         ${dist(withGtfs.map(r => r.cv))}`)

  for (const line of FOCUS) {
    const ord = order.get(line)
    if (!ord) continue
    console.log(`\nline ${line}: stop      dir    n  rateH  meanH  GTFS     CV`)
    const position = (r: Row) => ord[r.key.slice(-1) as Dir].get(r.key.split('@')[1]!.slice(3)) ?? 0
    for (const r of rows.filter(r => r.key.startsWith(`${line}@`))
      .sort((x, y) => x.key.slice(-1).localeCompare(y.key.slice(-1)) || position(x) - position(y))) {
      const [, stop, dir] = r.key.split('@')
      console.log(`  ${stop!.slice(3).padEnd(15)} ${dir}  ${String(r.n).padStart(5)}  ${r.rateH.toFixed(0).padStart(5)}  ${r.mean.toFixed(0).padStart(5)}  ${String(r.gtfs ?? '-').padStart(4)}  ${r.cv.toFixed(2).padStart(5)}`)
    }
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
