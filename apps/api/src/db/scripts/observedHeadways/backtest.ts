import type { DayAggregate } from './aggregate'
import { buildPool, column, fitPooled, MIN_DAY_HEALTHY_S, type ModelSpec, type Pool, type RateModel } from './fit'

/*
 * Next-day backtest.
 *
 * Truth for a held-out day is its own rate headway at a (key, hour): healthy
 * seconds / arrivals, needing at least MIN_DAY_HEALTHY_S of healthy time and
 * TRUTH_MIN_ARRIVALS arrivals. A model is scored by |log(predicted / actual)|
 * (0.2 is about +-22%).
 *
 *   loo      train on every other day. More data per fold; the number to
 *            compare estimators with.
 *   rolling  train only on days before the held-out one, which is what a
 *            nightly run actually faces.
 *
 * Models are compared on the intersection of buckets they ALL predict, so a
 * model that abstains on hard cells doesn't look better for it; coverage is
 * reported separately.
 *
 * What SHIPS is judged on a different intersection: the buckets the shipped
 * model and its baseline both predicted (`pair`). Using the all-model
 * intersection would score it only on stops the weakest predictor can also
 * cover (those with >= 5 pooled arrivals) and then ship it to the thinly
 * observed stops it was never scored on.
 *
 * Caveat: the truth is itself estimated from one day, so errors include
 * sampling noise on the truth. And it measures consistency across days, not
 * bias: arrivals the method misses depress every day the same way.
 */

export const TRUTH_MIN_ARRIVALS = 4
export const MIN_TRAIN_DAYS = 3

export interface GtfsLookup {
  (key: string): number | undefined
}

export function gtfsRawSpec(gtfs: GtfsLookup): ModelSpec {
  return { name: 'gtfsRaw', fit: () => ({ headway: key => gtfs(key) }) }
}

/** GTFS times a per-column factor: the median observed/GTFS ratio over the training stops. */
export function gtfsScaledSpec(gtfs: GtfsLookup): ModelSpec {
  return {
    name: 'gtfsScaled',
    fit(pool: Pool): RateModel {
      const pooled = fitPooled(pool)
      const scales = new Map<number, number>()
      for (let c = 0; c < 48; c++) {
        const ratios: number[] = []
        for (const key of pool.keys.keys()) {
          const dayType = c < 24 ? 'WD' : 'WE'
          const observed = pooled.headway(key, dayType, c % 24)
          const g = gtfs(key)
          if (observed !== undefined && g) ratios.push(observed / g)
        }
        if (ratios.length >= 20) scales.set(c, ratios.sort((a, b) => a - b)[Math.floor(ratios.length / 2)]!)
      }
      return {
        headway(key, dayType, hour) {
          const g = gtfs(key)
          const scale = scales.get(column(dayType, hour))
          if (!g || scale === undefined) return undefined
          return g * scale
        }
      }
    }
  }
}

export interface ModelScore {
  /** Share of truth buckets the model predicted at all. */
  coverage: number
  /** Over the intersection of buckets every model predicted. */
  median: number
  p75: number
}

export interface BacktestSummary {
  mode: 'loo' | 'rolling'
  folds: number
  truthBuckets: number
  intersection: number
  models: Record<string, ModelScore>
  /** Median error per column (see fit.column: day type x WIB hour) on the intersection, per model. */
  byColumn: Record<number, { n: number, median: Record<string, number> }>
  /**
   * Per column, the shipped model against its baseline over the buckets BOTH
   * predicted. Present when a `focus` was given. This is what vouching reads.
   */
  pair?: Record<number, { n: number, model: number, baseline: number }>
}

const quantile = (xs: number[], q: number) => {
  if (xs.length === 0) return NaN
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.floor(q * (s.length - 1))]!
}

export function backtest(
  days: readonly DayAggregate[],
  specs: readonly ModelSpec[],
  gtfs: GtfsLookup,
  mode: 'loo' | 'rolling',
  /** Only held-out days of this kind are scored; undefined scores all. */
  dayType?: 'WD' | 'WE',
  /** The shipped model and its baseline, for the pairwise per-column stats. */
  focus?: { model: string, baseline: string }
): BacktestSummary {
  const ordered = [...days].sort((a, b) => a.day.localeCompare(b.day))
  type Item = { column: number, errors: Map<string, number> }
  const items: Item[] = []
  let folds = 0
  let truthBuckets = 0

  ordered.forEach((held, index) => {
    if (dayType && held.dayType !== dayType) return
    const train = mode === 'loo'
      ? ordered.filter(d => d.day !== held.day)
      : ordered.slice(0, index)
    if (train.length < MIN_TRAIN_DAYS) return
    folds++
    const pool = buildPool(train)
    const models = specs.map(spec => [spec.name, spec.fit(pool)] as const)

    for (let hour = 0; hour < 24; hour++) {
      const healthy = held.healthySecByHour[hour] ?? 0
      if (healthy < MIN_DAY_HEALTHY_S) continue
      for (const [key, hours] of Object.entries(held.keys)) {
        const cell = hours[hour]
        if (!cell || cell[0] < TRUTH_MIN_ARRIVALS || !gtfs(key)) continue
        truthBuckets++
        const truth = healthy / cell[0]
        const errors = new Map<string, number>()
        for (const [name, model] of models) {
          const predicted = model.headway(key, held.dayType, hour)
          if (predicted !== undefined && predicted > 0) errors.set(name, Math.abs(Math.log(predicted / truth)))
        }
        items.push({ column: column(held.dayType, hour), errors })
      }
    }
  })

  const all = items.filter(item => specs.every(spec => item.errors.has(spec.name)))
  const models: Record<string, ModelScore> = {}
  for (const spec of specs) {
    const errs = all.map(item => item.errors.get(spec.name)!)
    models[spec.name] = {
      coverage: truthBuckets === 0 ? 0 : items.filter(item => item.errors.has(spec.name)).length / truthBuckets,
      median: quantile(errs, 0.5),
      p75: quantile(errs, 0.75)
    }
  }
  const byColumn: BacktestSummary['byColumn'] = {}
  for (const item of all) {
    const row = byColumn[item.column] ??= { n: 0, median: {} }
    row.n++
  }
  for (const c of Object.keys(byColumn).map(Number)) {
    const subset = all.filter(item => item.column === c)
    for (const spec of specs) {
      byColumn[c]!.median[spec.name] = quantile(subset.map(item => item.errors.get(spec.name)!), 0.5)
    }
  }

  let pair: BacktestSummary['pair']
  if (focus) {
    pair = {}
    const both = items.filter(item => item.errors.has(focus.model) && item.errors.has(focus.baseline))
    const columns = new Set(both.map(item => item.column))
    for (const c of columns) {
      const subset = both.filter(item => item.column === c)
      pair[c] = {
        n: subset.length,
        model: quantile(subset.map(item => item.errors.get(focus.model)!), 0.5),
        baseline: quantile(subset.map(item => item.errors.get(focus.baseline)!), 0.5)
      }
    }
  }
  return { mode, folds, truthBuckets, intersection: all.length, models, byColumn, pair }
}

/** A column needs at least this many held-out buckets before the backtest can vouch for it. */
export const MIN_VALIDATION_BUCKETS = 100

/**
 * Columns the backtest vouches for: enough held-out buckets, and the model's
 * median error beats the baseline's there. Everything else is not shipped,
 * so a consumer falls back to GTFS exactly where the model has not shown it
 * is better.
 */
export function vouchedColumns(summary: BacktestSummary, model: string, baseline: string): Set<number> {
  const out = new Set<number>()
  // Prefer the pairwise stats: they score the model over every bucket it can
  // predict, not only the ones every model in the comparison could.
  if (summary.pair) {
    for (const [c, row] of Object.entries(summary.pair)) {
      if (row.n >= MIN_VALIDATION_BUCKETS && row.model < row.baseline) out.add(Number(c))
    }
    return out
  }
  for (const [c, row] of Object.entries(summary.byColumn)) {
    if (row.n >= MIN_VALIDATION_BUCKETS && row.median[model]! < row.median[baseline]!) out.add(Number(c))
  }
  return out
}
