import { spawn } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as readline from 'node:readline'
import { parseArgs } from 'node:util'
import { TOPOLOGY } from '../data/topology'
import { DIRECTIONAL_HEADWAYS_S, STOP_HEADWAYS_S } from '../data/headways'

/*
 * Observed TJ headways from ward's snapshots (apps/ward, docs/adr/ward-collector.md),
 * compared against the GTFS-derived values in headways.ts.
 *
 *   pnpm --filter api analyze:headways --dir <dir> [--days 30] [--hours 17-19]
 *     [--lines 1,9] [--healthy-min 400] [--no-interpolate] [--max-obs-gap-ms 300000]
 *
 * <dir> holds ward's daily archives (snap-YYYYMMDD.ndjson.zst, from
 * `pnpm --filter @commute/ward pull`) and/or hourly files
 * (snap-YYYYMMDD-HH.ndjson.gz); when a day has an archive its hourly files are
 * ignored. Files are streamed line by line and only in-scope vehicles are
 * kept, so memory stays flat however many days are read.
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
 *   - The relay can send snapshots whose positions are stale. A snapshot in
 *     which fewer than --healthy-min in-scope buses updated counts as a gap,
 *     and so does any silence over 90s between snapshots (collector
 *     restarts, missing days).
 *   - Headway = healthy time / arrivals inside healthy time (a rate). The
 *     mean of consecutive gaps is also shown, but it is biased short when
 *     healthy windows are brief: a long headway is the one most likely to
 *     straddle a gap and get dropped.
 */

type Tuple = [string, string, string, number, number, number, number]
type Snap = { k: 's', t: number, v: Tuple[] }
type Gap = { k: 'gap', from: number, to: number, why: string }
type Dir = 'F' | 'R'
type Obs = { t: number, route: string, next: string }

const SILENCE_GAP_MS = 90_000
const REPLAY_WINDOW_MS = 5_000
const HEALTHY_STEP_MS = 10_000

const { values: args } = parseArgs({
  options: {
    'dir': { type: 'string' },
    'days': { type: 'string' },
    'hours': { type: 'string', default: '0-24' },
    'lines': { type: 'string', default: '1,10H' },
    'healthy-min': { type: 'string', default: '400' },
    'max-obs-gap-ms': { type: 'string', default: '300000' },
    'no-interpolate': { type: 'boolean', default: false }
  }
})

const HEALTHY_MIN = Number(args['healthy-min'])
const MAX_OBS_GAP_MS = Number(args['max-obs-gap-ms'])
const INTERPOLATE = !args['no-interpolate']
const [HOUR_FROM, HOUR_TO] = args.hours!.split('-').map(Number) as [number, number]
const FOCUS = args.lines!.split(',').filter(Boolean)

const wibHour = (t: number) => (new Date(t).getUTCHours() + 7) % 24
const inHours = (t: number) => wibHour(t) >= HOUR_FROM && wibHour(t) < HOUR_TO

/** Files to read, oldest first: a day's archive replaces its hourly files. */
function inputFiles(dir: string, days?: number): string[] {
  const names = fs.readdirSync(dir)
  const archives = new Map<string, string>()
  const hourly = new Map<string, string[]>()
  for (const name of names) {
    const archive = /^snap-(\d{8})\.ndjson\.zst$/.exec(name)
    if (archive) archives.set(archive[1]!, name)
    const hour = /^snap-(\d{8})-\d{2}\.ndjson\.gz$/.exec(name)
    if (hour) hourly.set(hour[1]!, [...(hourly.get(hour[1]!) ?? []), name])
  }
  let allDays = [...new Set([...archives.keys(), ...hourly.keys()])].sort()
  if (days) allDays = allDays.slice(-days)
  return allDays.flatMap(day => archives.has(day) ? [archives.get(day)!] : hourly.get(day)!.sort())
    .map(name => path.join(dir, name))
}

function lines(file: string) {
  const child = file.endsWith('.zst')
    ? spawn('zstd', ['-dc', '--long=27', file])
    : spawn('zcat', [file])
  return readline.createInterface({ input: child.stdout, crlfDelay: Infinity })
}

/** Merged, sorted [from, to] intervals with binary-search lookups. */
function intervals(gaps: Gap[]) {
  const merged: [number, number][] = []
  for (const g of [...gaps].sort((a, b) => a.from - b.from)) {
    const last = merged.at(-1)
    if (last && g.from <= last[1]) last[1] = Math.max(last[1], g.to)
    else merged.push([g.from, g.to])
  }
  /** Index of the last interval starting at or before t, or -1. */
  const floor = (t: number) => {
    let lo = 0, hi = merged.length - 1, found = -1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      if (merged[mid]![0] <= t) {
        found = mid
        lo = mid + 1
      } else {
        hi = mid - 1
      }
    }
    return found
  }
  return {
    merged,
    contains: (t: number) => {
      const i = floor(t)
      return i >= 0 && t <= merged[i]![1]
    },
    overlaps: (from: number, to: number) => {
      const i = floor(to)
      return i >= 0 && merged[i]![1] > from && merged[i]![0] < to
    }
  }
}

async function main() {
  if (!args.dir) throw new Error('--dir <dir> is required')
  const files = inputFiles(args.dir, args.days ? Number(args.days) : undefined)
  if (files.length === 0) throw new Error(`no snapshot files in ${args.dir}`)

  // ── topology: per line, stop order per direction ────────────────────────────
  const order = new Map<string, Record<Dir, Map<string, number>>>()
  for (const line of TOPOLOGY) {
    if (line.operator !== 'TJ') continue
    const reverse = line.pathReverse ?? [...line.path].reverse()
    order.set(line.lineCode, {
      F: new Map(line.path.filter(s => !s.passThrough).map((s, i) => [s.station, i])),
      R: new Map(reverse.filter(s => !s.passThrough).map((s, i) => [s.station, i]))
    })
  }

  // ── stream snapshots → per-vehicle series, deduped on the relay's update time ──
  const series = new Map<string, Obs[]>()
  const lastUpd = new Map<string, number>()
  const gaps: Gap[] = []
  let t0 = Infinity, t1 = -Infinity, snapCount = 0, degradedSnaps = 0
  let prevSnapT = 0, prevHealthy = true

  for (const file of files) {
    for await (const line of lines(file)) {
      if (!line) continue
      const rec = JSON.parse(line) as Snap | Gap | { k: 'start' }
      if (rec.k === 'gap') {
        gaps.push(rec)
        continue
      }
      if (rec.k !== 's') continue
      snapCount++
      t0 = Math.min(t0, rec.t)
      t1 = Math.max(t1, rec.t)
      let fresh = 0
      for (const [body, route, next, , , , upd] of rec.v) {
        if (lastUpd.get(body) === upd) continue
        lastUpd.set(body, upd)
        if (!order.has(route)) continue
        fresh++
        let list = series.get(body)
        if (!list) series.set(body, list = [])
        list.push({ t: upd, route, next: next ? next.split('-')[0]! : '' })
      }
      // Spike-era data kept the relay's replayed duplicate; it has zero fresh by construction.
      if (prevSnapT && rec.t - prevSnapT < REPLAY_WINDOW_MS) continue
      if (prevSnapT && rec.t - prevSnapT > SILENCE_GAP_MS) gaps.push({ k: 'gap', from: prevSnapT, to: rec.t, why: 'silence' })
      const healthy = fresh >= HEALTHY_MIN
      if (!healthy && prevSnapT) {
        degradedSnaps++
        const last = gaps.at(-1)
        // Extend a running stale stretch rather than stacking one gap per snapshot.
        if (!prevHealthy && last?.why === 'stale') last.to = rec.t
        else gaps.push({ k: 'gap', from: prevSnapT, to: rec.t, why: 'stale' })
      }
      prevHealthy = healthy
      prevSnapT = rec.t
    }
  }
  const unhealthy = intervals(gaps)

  // ── transitions → arrivals ─────────────────────────────────────────────────
  const stats = { transitions: 0, adjacent: 0, jump: 0, unknownStop: 0, wideGap: 0, routeChange: 0, ambiguousDir: 0 }
  const arrivals = new Map<string, number[]>() // `${line}@TJ-${stop}@${dir}` -> times
  for (const list of series.values()) {
    for (let i = 1; i < list.length; i++) {
      const a = list[i - 1]!, b = list[i]!
      if (!a.next || !b.next || a.next === b.next) continue
      stats.transitions++
      if (a.route !== b.route) {
        stats.routeChange++
        continue
      }
      const ord = order.get(a.route)!
      if (b.t - a.t > MAX_OBS_GAP_MS) {
        stats.wideGap++
        continue
      }
      const step = (d: Dir) => ord[d].get(b.next)! - ord[d].get(a.next)!
      const dirs = (['F', 'R'] as Dir[]).filter((d) => {
        const ia = ord[d].get(a.next), ib = ord[d].get(b.next)
        return ia !== undefined && ib !== undefined && ib > ia
      })
      if (dirs.length === 0) {
        stats.unknownStop++
        continue
      }
      // Both directions ascend only on loops/overlaps; the tighter step wins, a tie is unknowable.
      dirs.sort((x, y) => step(x) - step(y))
      if (dirs.length > 1 && step(dirs[0]!) === step(dirs[1]!)) {
        stats.ambiguousDir++
        continue
      }
      const d = dirs[0]!
      const n = step(d)
      if (n === 1) stats.adjacent++
      else stats.jump++
      const byIndex = [...ord[d]].sort((x, y) => x[1] - y[1]).map(([station]) => station)
      const from = ord[d].get(a.next)!
      const passed = INTERPOLATE ? byIndex.slice(from, from + n) : [a.next]
      passed.forEach((stop, k) => {
        const t = a.t + ((k + 0.5) / passed.length) * (b.t - a.t)
        if (!inHours(t)) return
        const key = `${a.route}@TJ-${stop}@${d}`
        let times = arrivals.get(key)
        if (!times) arrivals.set(key, times = [])
        times.push(t)
      })
    }
  }

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
  console.log(`${files.length} files, ${fmt(t0)} → ${fmt(t1)}, ${snapCount} snapshots (${degradedSnaps} degraded at HEALTHY_MIN=${HEALTHY_MIN})`)
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
