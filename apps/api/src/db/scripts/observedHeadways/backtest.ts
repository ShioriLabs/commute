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
 * Sparse cells: the |log| score above needs at least TRUTH_MIN_ARRIVALS in a
 * held-out hour, so a stop served every 30-60 minutes can never be scored, and
 * conditioning on that bias the truth towards short headways. Vouching therefore
 * uses a second score that has no such floor: the Poisson deviance of the
 * predicted count (healthy time / predicted headway) against the observed one,
 * n >= 0, over every key that plausibly runs in the column (the held-out day's
 * keys plus any with training arrivals there). Deviance is a proper score for
 * counts and needs no distributional claim beyond ranking two predictors.
 *
 * It is taken in two strata, split by what the model SHIPS for the key (for M2,
 * its line-direction's profile, not the stop's own factor-adjusted value): cells
 * under SPARSE_HEADWAY_S apart and cells at or over it. Each stratum is vouched
 * on its own, and a cell ships only if its stratum was. Pooled, a few thousand
 * easy frequent buckets would carry a column whose sparse cells lose to the
 * fallback (weekend daytime does exactly that on 2026-10-12 data).
 *
 * A stratum that was scored and LOST is different from one too thin to score:
 * its cells are held back (`heldBackCells`) and must not reappear through
 * interpolation from their neighbours either, which would ship an unvouched
 * value in the very place the backtest preferred the fallback.
 *
 * One guard on top of the pooled deviance. Counting empty buckets is what lets
 * sparse cells be scored at all, but it also rewards a model for simply
 * predicting less service than the fallback: every empty bucket then costs it
 * less. So a stratum must ALSO not be materially worse on the buckets where
 * buses actually ran (BUSES_TOLERANCE). On 2026-10-12 data this is what keeps
 * weekend 05:00-06:00 out: pooled it wins, but where buses ran its sparse cells
 * were 8-65% worse than the fallback.
 *
 * Caveat: the truth is itself estimated from one day, so errors include
 * sampling noise on the truth. And it measures consistency across days, not
 * bias: arrivals the method misses depress every day the same way.
 */

export const TRUTH_MIN_ARRIVALS = 4
export const MIN_TRAIN_DAYS = 3
/** A cell the model puts at least this far apart is "sparse": under 4 arrivals an hour. */
export const SPARSE_HEADWAY_S = 900

/** Poisson deviance of an observed count against an expected one (n >= 0, mu > 0). */
export function poissonDeviance(count: number, expected: number): number {
  const logTerm = count > 0 ? count * Math.log(count / expected) - count : 0
  return 2 * (logTerm + expected)
}

/**
 * On the buckets where buses ran, the model's mean deviance may be at most this
 * multiple of the baseline's. Not 1.0: a few percent is noise between two
 * predictors that are about equally good, and holding a column out for it would
 * be fitting the tolerance to the sample.
 */
export const BUSES_TOLERANCE = 1.05
/** Below this many with-buses buckets in a stratum the guard is not applied: too few to judge. */
export const MIN_BUSES_BUCKETS = 30

export interface StratumStats {
  n: number
  /** Summed deviance, so folds and columns can be pooled; divide by n for the mean. */
  devModel: number
  devBaseline: number
  /** The same, over only the buckets in which at least one arrival was observed. */
  nBuses: number
  devModelBuses: number
  devBaselineBuses: number
}

export interface ColumnStrata {
  frequent: StratumStats
  sparse: StratumStats
}

const emptyStratum = (): StratumStats => ({ n: 0, devModel: 0, devBaseline: 0, nBuses: 0, devModelBuses: 0, devBaselineBuses: 0 })

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
  /**
   * Per column, the model against its baseline by Poisson deviance, in the
   * frequent and sparse strata (see the header). Present when a `focus` was
   * given. This is what vouching reads.
   */
  strata?: Record<number, ColumnStrata>
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
  const strata: Record<number, ColumnStrata> = {}

  ordered.forEach((held, index) => {
    if (dayType && held.dayType !== dayType) return
    const train = mode === 'loo'
      ? ordered.filter(d => d.day !== held.day)
      : ordered.slice(0, index)
    if (train.length < MIN_TRAIN_DAYS) return
    folds++
    const pool = buildPool(train)
    const fold = { day: held.day, dayType: held.dayType }
    const models = specs.map(spec => [spec.name, spec.fit(pool, fold)] as const)
    const focusModels = focus
      ? {
          model: models.find(([name]) => name === focus.model)?.[1],
          baseline: models.find(([name]) => name === focus.baseline)?.[1]
        }
      : undefined

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

      if (!focusModels?.model || !focusModels.baseline) continue
      // Every key that plausibly runs here: seen on the held-out day, or with
      // training arrivals in this column. Counts include zero, which is the
      // point: a stop that barely runs is scored on not having been served.
      const c = column(held.dayType, hour)
      const universe = new Set<string>()
      for (const [key, byHour] of Object.entries(held.keys)) if (byHour[hour]) universe.add(key)
      for (const [key, counts] of pool.keys) if (counts.n[c]! > 0) universe.add(key)
      for (const key of universe) {
        const predicted = focusModels.model.headway(key, held.dayType, hour)
        const fallback = focusModels.baseline.headway(key, held.dayType, hour)
        if (predicted === undefined || fallback === undefined || predicted <= 0 || fallback <= 0) continue
        const count = held.keys[key]?.[hour]?.[0] ?? 0
        const row = strata[c] ??= { frequent: emptyStratum(), sparse: emptyStratum() }
        // The stratum is that of the cell that ships for this key (for M2 its
        // line-direction's profile), so the verdict covers exactly the stops
        // `selectShippedCells` later applies it to.
        const level = focusModels.model.stratumHeadway?.(key, held.dayType, hour) ?? predicted
        const stratum = level >= SPARSE_HEADWAY_S ? row.sparse : row.frequent
        const devModel = poissonDeviance(count, healthy / predicted)
        const devBaseline = poissonDeviance(count, healthy / fallback)
        stratum.n++
        stratum.devModel += devModel
        stratum.devBaseline += devBaseline
        if (count > 0) {
          stratum.nBuses++
          stratum.devModelBuses += devModel
          stratum.devBaselineBuses += devBaseline
        }
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
  return { mode, folds, truthBuckets, intersection: all.length, models, byColumn, pair, strata: focus ? strata : undefined }
}

/** A stratum needs at least this many held-out buckets before the backtest can vouch for it. */
export const MIN_VALIDATION_BUCKETS = 100

export interface VouchedStrata {
  frequent: boolean
  sparse: boolean
}

/**
 * One stratum's outcome. `unscored` (too few buckets) means the backtest could
 * not judge it; `loses` means it judged it and preferred the fallback.
 */
export function stratumVerdict(s: StratumStats): 'wins' | 'loses' | 'unscored' {
  if (s.n < MIN_VALIDATION_BUCKETS) return 'unscored'
  if (!(s.devModel < s.devBaseline)) return 'loses'
  // Not by predicting less service alone: where buses ran it must hold up too.
  if (s.nBuses >= MIN_BUSES_BUCKETS && s.devModelBuses > s.devBaselineBuses * BUSES_TOLERANCE) return 'loses'
  return 'wins'
}

/**
 * Per column and stratum: enough buckets, the model's deviance is lower than the
 * baseline's, and it is not materially worse on the buckets where buses ran. A
 * stratum with too few buckets is NOT vouched: the cells in it are unscored, and
 * unscored cells do not ship.
 */
export function vouchedStrata(summary: BacktestSummary): Map<number, VouchedStrata> {
  const out = new Map<number, VouchedStrata>()
  for (const [c, row] of Object.entries(summary.strata ?? {})) {
    const verdict = { frequent: stratumVerdict(row.frequent) === 'wins', sparse: stratumVerdict(row.sparse) === 'wins' }
    if (verdict.frequent || verdict.sparse) out.set(Number(c), verdict)
  }
  return out
}

/**
 * Profile cells that ship: each is one (line-direction, column) with a rate
 * (arrivals per second at an average stop), judged by the stratum its own
 * headway falls in. `rates` keys are `${line}@${dir}|${column}`.
 */
export function selectShippedCells(
  rates: ReadonlyMap<string, number>,
  strata: ReadonlyMap<number, VouchedStrata>
): Set<string> {
  const out = new Set<string>()
  for (const [id, perSecond] of rates) {
    const column = Number(id.slice(id.lastIndexOf('|') + 1))
    const verdict = strata.get(column)
    if (!verdict) continue
    const sparse = 1 / perSecond >= SPARSE_HEADWAY_S
    if (sparse ? verdict.sparse : verdict.frequent) out.add(id)
  }
  return out
}

/**
 * Profile cells whose stratum the backtest scored and found worse than the
 * fallback. Unlike a cell in an unscored stratum (a thin night hour, a blind
 * rush hour), the fallback is the measured better answer here, so interpolation
 * must not fill these back in. Same keys and stratum split as `selectShippedCells`.
 */
export function heldBackCells(
  rates: ReadonlyMap<string, number>,
  summary: BacktestSummary
): Set<string> {
  const out = new Set<string>()
  for (const [id, perSecond] of rates) {
    const row = summary.strata?.[Number(id.slice(id.lastIndexOf('|') + 1))]
    if (!row) continue
    const stratum = 1 / perSecond >= SPARSE_HEADWAY_S ? row.sparse : row.frequent
    if (stratumVerdict(stratum) === 'loses') out.add(id)
  }
  return out
}

/**
 * Columns with at least one shipped stratum. These define the interpolation
 * spans and where caps are measured; which CELLS ship is `selectShippedCells`.
 *
 * With stats by stratum this is the deviance verdict; for a summary without them
 * (a backtest run with no focus) it falls back to the median-error pair stats.
 */
export function vouchedColumns(summary: BacktestSummary, model: string, baseline: string): Set<number> {
  if (summary.strata) return new Set(vouchedStrata(summary).keys())

  const out = new Set<number>()
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
