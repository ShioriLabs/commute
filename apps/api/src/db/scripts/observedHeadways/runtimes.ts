import type { LineTopology } from '../../data/topology'
import type { DayType } from './aggregate'
import { blockLabel, type DayTrips, RUNTIME_BLOCKS } from './dayTrips'
import { quote } from './render'

/*
 * Observed TJ run times and service windows from reconstructed trips
 * (docs/tj-observed-timings.md). Estimated quantities, not a timetable.
 *
 * Each (line, direction, hop) × day type × hour block gets, in order:
 *   OBSERVED  at least MIN_HOP_N directly observed hop times: their median.
 *   SCALED    the hop's OBSERVED value in the line-direction's best-covered
 *             block, times the ratio of full-trip medians between the blocks.
 *             This carries the weekday peaks, where few hops are seen whole but
 *             full trips still are.
 *   DISTANCE  terminus hops (never measurable: see dayTrips.ts) and hops never
 *             seen in any block: metres at the line-direction's pace in that
 *             bucket, from its other cells.
 * Anything else is left out; the consumer keeps its own fallback. A whole
 * (day type, block, basis) stratum is dropped when the leave-one-day-out
 * backtest does not show it beating a constant-speed-per-line baseline.
 */

export const MIN_HOP_N = 30
/** Full trips a block needs before its trip median can scale hops. */
export const MIN_TRIPS = 10
/** Share of interior hops with a cell before a bucket's pace may price DISTANCE hops. */
export const MIN_PACE_SHARE = 0.5
/** Held-out hops a (day, hop, block) needs to be a truth bucket. */
export const MIN_HELD_OUT_HOPS = 5
/** Held-out full trips a (day, line-direction, block) needs to be a truth bucket. */
export const MIN_HELD_OUT_TRIPS = 3
/** Truth buckets a stratum needs before the backtest can vouch for it. */
export const MIN_STRATUM_BUCKETS = 50
/** First and last buses must agree this closely across days. */
export const WINDOW_AGREE_S = 1800
/** Stop-1 passings a day needs to count as the line running that day, not a stray bus. */
export const MIN_DAY_PASSINGS = 10

const DAY_TYPES: readonly DayType[] = ['WD', 'WE']

export type Basis = 'OBSERVED' | 'SCALED' | 'DISTANCE'

const sorted = (xs: readonly number[]) => [...xs].sort((a, b) => a - b)
const quantile = (s: readonly number[], q: number) => s[Math.min(s.length - 1, Math.floor(q * s.length))]!
const median = (xs: readonly number[]) => quantile(sorted(xs), 0.5)
const naturalCompare = (a: string, b: string) => a.localeCompare(b, 'en', { numeric: true })

// ── geometry ──

export interface LineGeometry {
  /** Station ids in travel order, pass-throughs excluded (as `buildOrder`). */
  stops: string[]
  /** Metres of hop i (stops[i] -> stops[i + 1]), from TOPOLOGY's cumM; undefined where unknown. */
  hopMetres: (number | undefined)[]
}

type TopologyLine = Pick<LineTopology, 'operator' | 'lineCode' | 'path' | 'pathReverse'>

/** `${line}@${dir}` -> stops and hop lengths, in the same stop order `buildOrder` uses. */
export function lineGeometry(topology: readonly TopologyLine[]): Map<string, LineGeometry> {
  const out = new Map<string, LineGeometry>()
  for (const line of topology) {
    if (line.operator !== 'TJ') continue
    const forward = line.path.filter(s => !s.passThrough)
    const total = line.path.at(-1)?.cumM
    const reverse = line.pathReverse
      ? line.pathReverse.filter(s => !s.passThrough).map(s => ({ station: s.station, cumM: s.cumM }))
      : [...forward].reverse().map(s => ({
          station: s.station,
          cumM: s.cumM === undefined || total === undefined ? undefined : total - s.cumM
        }))
    const geometry = (stops: readonly { station: string, cumM?: number }[]): LineGeometry => ({
      stops: stops.map(s => s.station),
      hopMetres: stops.slice(1).map((s, i) => {
        const a = stops[i]!.cumM
        return s.cumM === undefined || a === undefined ? undefined : s.cumM - a
      })
    })
    out.set(`${line.lineCode}@F`, geometry(forward))
    out.set(`${line.lineCode}@R`, geometry(reverse))
  }
  return out
}

// ── pooling ──

export interface TripPool {
  /** `${dt}|${line}@${dir}|${hop}|${block}` -> hop seconds. */
  hops: Map<string, number[]>
  /** `${dt}|${line}@${dir}|${block}` -> stop 1 to second-to-last seconds. */
  trips: Map<string, number[]>
}

export function poolTrips(days: readonly DayTrips[]): TripPool {
  const pool: TripPool = { hops: new Map(), trips: new Map() }
  const add = (map: Map<string, number[]>, key: string, xs: readonly number[]) => {
    const list = map.get(key)
    if (list) list.push(...xs)
    else map.set(key, [...xs])
  }
  for (const day of days) {
    for (const [key, xs] of Object.entries(day.hops)) add(pool.hops, `${day.dayType}|${key}`, xs)
    for (const [key, xs] of Object.entries(day.trips)) add(pool.trips, `${day.dayType}|${key}`, xs)
  }
  return pool
}

// ── fit ──

export interface HopCell {
  s: number
  p75: number
  basis: Basis
}

export interface TripCell {
  s: number
  p75: number
  n: number
}

export interface RuntimeFit {
  /** `${dt}|${line}@${dir}|${hop}|${block}` -> cell. */
  hops: Map<string, HopCell>
  /** `${dt}|${line}@${dir}|${block}` -> full-trip time, where at least MIN_TRIPS were seen. */
  trips: Map<string, TripCell>
  /** `${line}@${dir}` -> interior hops never seen in any bucket while a neighbour was seen often. */
  mismatches: Map<string, number[]>
}

export type StratumFilter = (dt: DayType, block: number, basis: Basis) => boolean

const hopKey = (dt: DayType, ld: string, hop: number, block: number) => `${dt}|${ld}|${hop}|${block}`

/**
 * Interior hops (1 .. hopCount-2) with no observation at all, next to one seen
 * at least MIN_HOP_N times: the buses never report that stop pair, so the
 * topology probably disagrees with the route they run.
 */
function findMismatches(pool: TripPool, ld: string, hopCount: number): number[] {
  const total = (i: number) => {
    let n = 0
    for (const dt of DAY_TYPES) {
      for (let b = 0; b < RUNTIME_BLOCKS.length; b++) n += pool.hops.get(hopKey(dt, ld, i, b))?.length ?? 0
    }
    return n
  }
  const out: number[] = []
  for (let i = 1; i <= hopCount - 2; i++) {
    if (total(i) === 0 && Math.max(total(i - 1), total(i + 1)) >= MIN_HOP_N) out.push(i)
  }
  return out
}

export function fitRuntimes(
  pool: TripPool,
  geometry: ReadonlyMap<string, LineGeometry>,
  allow: StratumFilter = () => true
): RuntimeFit {
  const fit: RuntimeFit = { hops: new Map(), trips: new Map(), mismatches: new Map() }
  for (const [ld, geo] of geometry) {
    const hopCount = geo.stops.length - 1
    if (hopCount < 3) continue
    const mismatches = findMismatches(pool, ld, hopCount)
    if (mismatches.length > 0) fit.mismatches.set(ld, mismatches)

    for (const dt of DAY_TYPES) {
      const tripCells = RUNTIME_BLOCKS.map((_, b) => {
        const xs = pool.trips.get(`${dt}|${ld}|${b}`)
        if (!xs || xs.length < MIN_TRIPS) return undefined
        const s = sorted(xs)
        const cell: TripCell = { s: quantile(s, 0.5), p75: quantile(s, 0.75), n: s.length }
        fit.trips.set(`${dt}|${ld}|${b}`, cell)
        return cell
      })
      let ref = -1
      tripCells.forEach((c, b) => {
        if (c && (ref < 0 || c.n > tripCells[ref]!.n)) ref = b
      })

      const observed = (i: number, b: number): HopCell | undefined => {
        const xs = pool.hops.get(hopKey(dt, ld, i, b))
        if (!xs || xs.length < MIN_HOP_N) return undefined
        const s = sorted(xs)
        return { s: quantile(s, 0.5), p75: quantile(s, 0.75), basis: 'OBSERVED' }
      }

      for (let b = 0; b < RUNTIME_BLOCKS.length; b++) {
        const chosen = new Map<number, HopCell>()
        for (let i = 1; i <= hopCount - 2; i++) {
          const own = observed(i, b)
          if (own) {
            if (allow(dt, b, 'OBSERVED')) chosen.set(i, own)
            continue
          }
          const base = ref >= 0 && ref !== b ? observed(i, ref) : undefined
          const here = tripCells[b], there = ref >= 0 ? tripCells[ref] : undefined
          if (base && here && there && allow(dt, b, 'SCALED')) {
            const ratio = here.s / there.s
            chosen.set(i, { s: Math.round(base.s * ratio), p75: Math.round(base.p75 * ratio), basis: 'SCALED' })
          }
        }

        // Pace from the cells chosen above, for the hops nobody can measure.
        let seconds = 0, seconds75 = 0, metres = 0, priced = 0
        for (const [i, cell] of chosen) {
          const m = geo.hopMetres[i]
          if (m === undefined || m <= 0) continue
          seconds += cell.s
          seconds75 += cell.p75
          metres += m
          priced++
        }
        if (priced > 0 && priced >= MIN_PACE_SHARE * (hopCount - 2) && allow(dt, b, 'DISTANCE')) {
          for (const i of [0, hopCount - 1, ...mismatches]) {
            const m = geo.hopMetres[i]
            if (m === undefined || m <= 0) continue
            chosen.set(i, { s: Math.round(m * seconds / metres), p75: Math.round(m * seconds75 / metres), basis: 'DISTANCE' })
          }
        }
        for (const [i, cell] of chosen) fit.hops.set(hopKey(dt, ld, i, b), cell)
      }
    }
  }
  return fit
}

// ── backtest ──

export interface StratumScore {
  dt: DayType
  block: number
  basis: Basis
  buckets: number
  /** Median |log(predicted / held-out median)|. */
  model: number
  baseline: number
}

export interface TripScore {
  dt: DayType
  block: number
  buckets: number
  model: number
  baseline: number
}

/**
 * The baseline: one pace per line-direction (median seconds per metre over all
 * its interior hops), what a speed class per line would give at best.
 */
function linePaces(pool: TripPool, geometry: ReadonlyMap<string, LineGeometry>): Map<string, number> {
  const paces = new Map<string, number[]>()
  for (const [key, xs] of pool.hops) {
    const [, ld, hop] = key.split('|') as [string, string, string]
    const geo = geometry.get(ld)
    const m = geo?.hopMetres[Number(hop)]
    if (!geo || m === undefined || m <= 0) continue
    let list = paces.get(ld)
    if (!list) paces.set(ld, list = [])
    for (const s of xs) list.push(s / m)
  }
  return new Map([...paces].map(([ld, xs]) => [ld, median(xs)]))
}

export function backtest(days: readonly DayTrips[], geometry: ReadonlyMap<string, LineGeometry>): {
  strata: StratumScore[]
  trips: TripScore[]
} {
  const hopErr = new Map<string, { model: number[], baseline: number[] }>()
  const tripErr = new Map<string, { model: number[], baseline: number[] }>()
  const push = (map: typeof hopErr, key: string, model: number, baseline: number) => {
    let e = map.get(key)
    if (!e) map.set(key, e = { model: [], baseline: [] })
    e.model.push(model)
    e.baseline.push(baseline)
  }

  for (const held of days) {
    const train = poolTrips(days.filter(d => d !== held))
    const fit = fitRuntimes(train, geometry)
    const paces = linePaces(train, geometry)
    const dt = held.dayType

    for (const [key, xs] of Object.entries(held.hops)) {
      if (xs.length < MIN_HELD_OUT_HOPS) continue
      const [ld, hop, block] = key.split('|') as [string, string, string]
      const geo = geometry.get(ld), pace = paces.get(ld)
      const i = Number(hop), m = geo?.hopMetres[i]
      if (!geo || pace === undefined || m === undefined || m <= 0) continue
      if (i < 1 || i > geo.stops.length - 3) continue
      const cell = fit.hops.get(hopKey(dt, ld, i, Number(block)))
      if (!cell) continue
      const truth = median(xs)
      if (truth <= 0) continue
      push(hopErr, `${dt}|${block}|${cell.basis}`, Math.abs(Math.log(cell.s / truth)), Math.abs(Math.log((m * pace) / truth)))
    }

    for (const [key, xs] of Object.entries(held.trips)) {
      if (xs.length < MIN_HELD_OUT_TRIPS) continue
      const [ld, block] = key.split('|') as [string, string]
      const geo = geometry.get(ld), pace = paces.get(ld)
      if (!geo || pace === undefined) continue
      let predicted = 0, base = 0, complete = true
      for (let i = 1; i <= geo.stops.length - 3; i++) {
        const cell = fit.hops.get(hopKey(dt, ld, i, Number(block)))
        const m = geo.hopMetres[i]
        if (!cell || m === undefined) {
          complete = false
          break
        }
        predicted += cell.s
        base += m * pace
      }
      if (!complete) continue
      const truth = median(xs)
      push(tripErr, `${dt}|${block}`, Math.abs(Math.log(predicted / truth)), Math.abs(Math.log(base / truth)))
    }
  }

  const strata = [...hopErr].map(([key, e]) => {
    const [dt, block, basis] = key.split('|') as [DayType, string, Basis]
    return { dt, block: Number(block), basis, buckets: e.model.length, model: median(e.model), baseline: median(e.baseline) }
  })
  const trips = [...tripErr].map(([key, e]) => {
    const [dt, block] = key.split('|') as [DayType, string]
    return { dt, block: Number(block), buckets: e.model.length, model: median(e.model), baseline: median(e.baseline) }
  })
  const byStratum = (a: { dt: string, block: number }, b: { dt: string, block: number }) =>
    a.dt.localeCompare(b.dt) || a.block - b.block
  return { strata: strata.sort((a, b) => byStratum(a, b) || a.basis.localeCompare(b.basis)), trips: trips.sort(byStratum) }
}

/**
 * The strata the backtest vouches for. DISTANCE cannot be scored (nobody sees
 * those hops), so it rides on the block's measured strata: it ships when the
 * cells its pace is computed from do, which `fitRuntimes` enforces by pricing
 * only from cells that passed this filter.
 */
export function vouchedStrata(strata: readonly StratumScore[]): StratumFilter {
  const ok = new Set(strata
    .filter(s => s.buckets >= MIN_STRATUM_BUCKETS && s.model < s.baseline)
    .map(s => `${s.dt}|${s.block}|${s.basis}`))
  return (dt, block, basis) => basis === 'DISTANCE' || ok.has(`${dt}|${block}|${basis}`)
}

// ── service windows ──

export type WindowDay = 'WD' | 'SAT' | 'SUN'

export interface WindowCell {
  /** Seconds since WIB midnight of the first / last stop-1 passing. */
  first?: number
  last?: number
  /** Buses seen at stop 1 in the small hours (NIGHT_HOURS) on enough days. */
  allDay?: true
  /** Trusted days behind the value (the smaller side when both edges agree). */
  days: number
}

const secOfDay = (t: number) => Math.round(((t + 7 * 3_600_000) % 86_400_000) / 1000)

/** The median of the values within WINDOW_AGREE_S of the median, when enough of them agree. */
function agreed(xs: readonly number[], minDays: number): { value: number, days: number } | undefined {
  if (xs.length < minDays) return undefined
  const m = median(xs)
  const near = xs.filter(x => Math.abs(x - m) <= WINDOW_AGREE_S)
  if (near.length < minDays || near.length < (2 / 3) * xs.length) return undefined
  return { value: median(near), days: near.length }
}

/**
 * First and last bus per line-direction and service day, from edges the
 * collector was healthy around, on days the line really ran (MIN_DAY_PASSINGS).
 * Weekdays need 3 agreeing days; the sample has only two of each weekend day,
 * so those need both. A line with night service on as many days is allDay: its
 * per-day first and last are just the archive's midnight cut.
 */
export function fitWindows(days: readonly DayTrips[]): Map<string, Partial<Record<WindowDay, WindowCell>>> {
  const edges = new Map<string, { firsts: number[], lasts: number[], ran: number, nights: number }>()
  for (const day of days) {
    for (const [ld, e] of Object.entries(day.edges)) {
      if (e.count < MIN_DAY_PASSINGS) continue
      const key = `${ld}|${day.serviceDay}`
      let entry = edges.get(key)
      if (!entry) edges.set(key, entry = { firsts: [], lasts: [], ran: 0, nights: 0 })
      entry.ran++
      if (e.night) entry.nights++
      if (e.firstOk) entry.firsts.push(secOfDay(e.first))
      if (e.lastOk) entry.lasts.push(secOfDay(e.last))
    }
  }
  const out = new Map<string, Partial<Record<WindowDay, WindowCell>>>()
  for (const [key, { firsts, lasts, ran, nights }] of edges) {
    const [ld, sd] = key.split('|') as [string, WindowDay]
    const minDays = sd === 'WD' ? 3 : 2
    const first = agreed(firsts, minDays), last = agreed(lasts, minDays)
    let cell: WindowCell
    if (nights >= minDays && nights >= (2 / 3) * ran) {
      cell = { allDay: true, days: nights }
    } else if (!first && !last) {
      continue
    } else {
      cell = { days: Math.min(first?.days ?? Infinity, last?.days ?? Infinity) }
      if (first) cell.first = first.value
      if (last) cell.last = last.value
    }
    let entry = out.get(ld)
    if (!entry) out.set(ld, entry = {})
    entry[sd] = cell
  }
  return out
}

// ── render ──

export interface RuntimesInput {
  fit: RuntimeFit
  windows: ReadonlyMap<string, Partial<Record<WindowDay, WindowCell>>>
  geometry: ReadonlyMap<string, LineGeometry>
  range: { from: string, to: string }
  dayCounts: Record<WindowDay, number>
}

const stationId = (stop: string) => `TJ-${stop}`

export function renderRuntimes(input: RuntimesInput): string {
  const hopRows: [string, string][] = []
  for (const [key, cell] of input.fit.hops) {
    const [dt, ld, hop, block] = key.split('|') as [DayType, string, string, string]
    const stops = input.geometry.get(ld)!.stops
    const i = Number(hop)
    hopRows.push([
      `${dt}:${blockLabel(Number(block))}:${ld}:${stationId(stops[i]!)}>${stationId(stops[i + 1]!)}`,
      `[${cell.s}, ${cell.p75}, ${quote(cell.basis)}]`
    ])
  }
  const tripRows: [string, string][] = [...input.fit.trips].map(([key, cell]) => {
    const [dt, ld, block] = key.split('|') as [DayType, string, string]
    return [`${dt}:${blockLabel(Number(block))}:${ld}`, `[${cell.s}, ${cell.p75}, ${cell.n}]`]
  })
  const windowRows: [string, string][] = [...input.windows].map(([ld, byDay]) => {
    const parts = (['WD', 'SAT', 'SUN'] as const).flatMap((sd) => {
      const c = byDay[sd]
      if (!c) return []
      const fields = [
        c.first !== undefined ? `first: ${c.first}` : undefined,
        c.last !== undefined ? `last: ${c.last}` : undefined,
        c.allDay ? 'allDay: true' : undefined,
        `days: ${c.days}`
      ].filter(Boolean)
      return [`${sd}: { ${fields.join(', ')} }`]
    })
    return [ld, `{ ${parts.join(', ')} }`]
  })
  const mismatchRows: [string, string][] = [...input.fit.mismatches].map(([ld, hops]) => {
    const stops = input.geometry.get(ld)!.stops
    return [ld, `[${hops.map(i => quote(`${stationId(stops[i]!)}>${stationId(stops[i + 1]!)}`)).join(', ')}]`]
  })
  const table = (rows: [string, string][], indent = '  ') =>
    rows.sort((a, b) => naturalCompare(a[0], b[0])).map(([k, v]) => `${indent}${quote(k)}: ${v}`).join(',\n')

  return [
    '/*',
    ' * Observed TransJakarta run times and service windows, from trips',
    ' * reconstructed out of ward\'s vehicle snapshots.',
    ' *',
    ' * GENERATED — do not edit by hand; re-run `pnpm --filter api fit:tj-runtimes`.',
    ' * See scripts/fitTjRuntimes.ts, observedHeadways/runtimes.ts and',
    ' * docs/tj-observed-timings.md. Nothing at runtime reads this yet: it is the',
    ' * measured input for docs/router-time-objective.md.',
    ' *',
    ' * OBSERVED_HOP_S[`${dayType}:${block}:${line}@${dir}:${fromStation}>${toStation}`]',
    ' * = [median s, p75 s, basis] for one hop between adjacent stops, from the',
    ' * moment a bus passes the first stop to the moment it passes the next: ride',
    ' * plus dwell. dayType is WD (Mon-Fri) or WE (Sat, Sun, holidays); block is a',
    ' * WIB hour range from OBSERVED_RUNTIME_BLOCKS. Basis:',
    ` *   OBSERVED  median of at least ${MIN_HOP_N} hop times seen directly.`,
    ' *   SCALED    the hop\'s observed time in its line-direction\'s best-covered',
    ' *             block, times that block\'s full-trip ratio to this one.',
    ' *   DISTANCE  terminus hops (unmeasurable: the last is never seen, the first',
    ' *             holds the layover) and hops the buses never report: metres at',
    ' *             the line-direction\'s pace in that bucket.',
    ' * A missing key means no estimate; keep whatever the caller used before. The',
    ' * leave-one-day-out backtest drops whole (dayType, block, basis) strata that',
    ' * do not beat one constant speed per line.',
    ' *',
    ' * OBSERVED_TRIP_S[`${dayType}:${block}:${line}@${dir}`] = [median s, p75 s, n]:',
    ' * stop 1 to the second-to-last stop, from full trips.',
    ' *',
    ' * OBSERVED_SERVICE_WINDOWS[`${line}@${dir}`][WD | SAT | SUN]: the first and',
    ' * last stop-1 passing in seconds since WIB midnight, medians over days the',
    ' * collector was healthy around them; `days` is how many agreed (weekdays',
    ' * need 3, weekend days both of the 2 in the sample). allDay = buses from just',
    ' * after midnight to just before it.',
    ' */',
    '',
    `export const OBSERVED_RUNTIME_BLOCKS = [${RUNTIME_BLOCKS.map((_, b) => quote(blockLabel(b))).join(', ')}] as const`,
    '',
    'export const OBSERVED_RUNTIMES_META = {',
    `  from: ${quote(input.range.from)},`,
    `  to: ${quote(input.range.to)},`,
    `  days: { WD: ${input.dayCounts.WD}, SAT: ${input.dayCounts.SAT}, SUN: ${input.dayCounts.SUN} },`,
    `  minHopN: ${MIN_HOP_N},`,
    `  minTrips: ${MIN_TRIPS},`,
    '  /** Interior hops never reported while a neighbour was: likely topology disagreements. */',
    '  mismatchedHops: {',
    table(mismatchRows, '    '),
    '  } as Record<string, readonly string[]>',
    '} as const',
    '',
    'export type RuntimeBasis = \'OBSERVED\' | \'SCALED\' | \'DISTANCE\'',
    '',
    'export const OBSERVED_HOP_S: Record<string, readonly [number, number, RuntimeBasis]> = {',
    table(hopRows),
    '}',
    '',
    'export const OBSERVED_TRIP_S: Record<string, readonly [number, number, number]> = {',
    table(tripRows),
    '}',
    '',
    'export interface ObservedWindow {',
    '  first?: number',
    '  last?: number',
    '  allDay?: true',
    '  days: number',
    '}',
    '',
    'export const OBSERVED_SERVICE_WINDOWS: Record<string, Partial<Record<\'WD\' | \'SAT\' | \'SUN\', ObservedWindow>>> = {',
    table(windowRows),
    '}',
    ''
  ].join('\n')
}
