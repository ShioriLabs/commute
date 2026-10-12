import { describe, expect, it } from 'vitest'
import type { Cell, DayAggregate, DayType } from './aggregate'
import { backtest, gtfsRawSpec, MIN_VALIDATION_BUCKETS, vouchedColumns } from './backtest'
import { buildPool, clampHeadway, column, fitFactorised, fitPooled, fitShrunk, MIN_STOP_FACTOR, pooledCv } from './fit'
import { profileKey, renderOverlay } from './render'

/*
 * Synthetic days with a known multiplicative ground truth: the line-direction
 * T@F runs a headway per hour, and each stop sees it scaled by a factor. Counts
 * are the exact expectation, so a correct fit recovers the truth.
 */
type Truth = { hours: Record<number, number>, factors: Record<string, number> }

const FACTORS = { S1: 0.8, S2: 1, S3: 1.2, S4: 1, S5: 1 }

function day(date: string, truth: Truth, healthy = 3600, dayType: DayType = 'WD'): DayAggregate {
  const healthySecByHour = new Array<number>(24).fill(0)
  const keys: DayAggregate['keys'] = {}
  for (const [hourText, headway] of Object.entries(truth.hours)) {
    const hour = Number(hourText)
    healthySecByHour[hour] = healthy
    for (const [stop, factor] of Object.entries(truth.factors)) {
      const n = (healthy / headway) * factor
      const cell: Cell = [n, 0, 0, 0]
      ;(keys[`T@TJ-${stop}@F`] ??= {})[hour] = cell
    }
  }
  return { schema: 1, day: date, dayType, t0: 0, t1: 0, healthySecByHour, keys }
}

const TRUTH: Truth = { hours: { 10: 300, 11: 600 }, factors: FACTORS }
const dates = ['20261005', '20261006', '20261007', '20261008', '20261009']
const days = dates.map(d => day(d, TRUTH))

describe('pooled and shrunk estimators', () => {
  const pool = buildPool(days)

  it('pooled is healthy time over arrivals', () => {
    // 5 days x 3600s; S2 sees 12 arrivals an hour.
    expect(fitPooled(pool).headway('T@TJ-S2@F', 'WD', 10)).toBeCloseTo(300, 6)
    expect(fitPooled(pool).headway('T@TJ-S1@F', 'WD', 10)).toBeCloseTo(300 / 0.8, 6)
  })

  it('abstains where there is too little healthy time or no data', () => {
    expect(fitPooled(pool).headway('T@TJ-S2@F', 'WD', 3)).toBeUndefined()
    expect(fitPooled(pool).headway('T@TJ-S2@F', 'WE', 10)).toBeUndefined()
    expect(fitPooled(pool).headway('T@NOPE@F', 'WD', 10)).toBeUndefined()
  })

  it('sits between the line-direction prior and the pooled value, nearer the data when arrivals are plentiful', () => {
    // S1: pooled 375s from 48 arrivals; the line-direction's median stop is 300s.
    const shrunk = fitShrunk(pool, 6).headway('T@TJ-S1@F', 'WD', 10)!
    expect(shrunk).toBeGreaterThan(300)
    expect(shrunk).toBeLessThan(375)
    expect(375 - shrunk).toBeLessThan(shrunk - 300)
    // More shrinkage moves it further towards the prior.
    expect(fitShrunk(pool, 24).headway('T@TJ-S1@F', 'WD', 10)!).toBeLessThan(shrunk)
  })

  it('pulls a thin stop towards its neighbours where pooled would swing', () => {
    const base = days[0]!
    // S5 saw 6 arrivals in 3600s on one day (600s headway) while its line-direction runs ~300s.
    const thin: DayAggregate = { ...base, keys: { ...base.keys, 'T@TJ-S5@F': { 10: [6, 0, 0, 0] } } }
    const pool = buildPool([thin])
    const pooled = fitPooled(pool).headway('T@TJ-S5@F', 'WD', 10)!
    const shrunk = fitShrunk(pool, 6).headway('T@TJ-S5@F', 'WD', 10)!
    expect(pooled).toBeCloseTo(600, 6)
    expect(shrunk).toBeLessThan(pooled)
    expect(shrunk).toBeGreaterThan(300)
  })
})

describe('fitFactorised', () => {
  it('recovers a multiplicative ground truth', () => {
    const model = fitFactorised(buildPool(days))
    for (const [stop, factor] of Object.entries(FACTORS)) {
      for (const [hour, headway] of [[10, 300], [11, 600]] as const) {
        const predicted = model.headway(`T@TJ-${stop}@F`, 'WD', hour)!
        // Factors are normalised to mean 1 (they already are here), and shrunk a
        // little towards 1 by STOP_SHRINK_KAPPA pseudo-arrivals, hence the 3%.
        const expected = headway / factor
        expect(Math.abs(predicted / expected - 1)).toBeLessThan(0.03)
      }
    }
  })

  it('has no profile for a column with fewer than 3 usable days', () => {
    const model = fitFactorised(buildPool(days.slice(0, 2)))
    expect(model.headway('T@TJ-S2@F', 'WD', 10)).toBeUndefined()
  })

  it('has no profile for a column with too little pooled arrivals', () => {
    const quiet = dates.map(d => day(d, { hours: { 10: 100_000 }, factors: FACTORS }))
    expect(fitFactorised(buildPool(quiet)).headway('T@TJ-S2@F', 'WD', 10)).toBeUndefined()
  })

  it('gives a stop under the arrival floor no factor and no headway', () => {
    const truth: Truth = { hours: { 10: 300 }, factors: { ...FACTORS, GHOST: 0.05 } }
    const pool = buildPool(dates.map(d => day(d, truth)))
    // 0.05 of 12/h over 5 days is 3 arrivals: under MIN_STOP_ARRIVALS.
    const model = fitFactorised(pool)
    expect(model.factor.has('T@TJ-GHOST@F')).toBe(false)
    expect(model.headway('T@TJ-GHOST@F', 'WD', 10)).toBeUndefined()
    // The others are unaffected by the dropped stop.
    expect(model.headway('T@TJ-S2@F', 'WD', 10)!).toBeGreaterThan(0)
  })

  it('drops a seen-but-rare stop above the arrival floor and refits without it', () => {
    const many = { hours: { 10: 60 }, factors: { S1: 1, S2: 1, S3: 1, S4: 1, RARE: 0.15 } }
    const pool = buildPool(dates.map(d => day(d, many, 3600)))
    const model = fitFactorised(pool)
    expect(model.factor.get('T@TJ-RARE@F')).toBeUndefined()
    expect(MIN_STOP_FACTOR).toBeGreaterThan(0.15)
    expect(model.headway('T@TJ-S1@F', 'WD', 10)).toBeCloseTo(60, 0)
  })

  it('keeps day types apart', () => {
    const weekend = dates.map(d => day(d, { hours: { 10: 900 }, factors: FACTORS }, 3600, 'WE'))
    const model = fitFactorised(buildPool([...days, ...weekend]))
    const wd = model.headway('T@TJ-S2@F', 'WD', 10)!
    const we = model.headway('T@TJ-S2@F', 'WE', 10)!
    expect(we / wd).toBeCloseTo(3, 1)
  })
})

describe('clampHeadway', () => {
  it('holds values inside the same bounds as headways.ts', () => {
    expect(clampHeadway(30)).toBe(120)
    expect(clampHeadway(250.4)).toBe(250)
    expect(clampHeadway(99_999)).toBe(3600)
  })
})

describe('pooledCv', () => {
  it('computes the CV of consecutive gaps pooled over stops', () => {
    // Gaps of 100s and 300s in equal measure: mean 200, sd 100, CV 0.5.
    const cell: Cell = [30, 30, 6000, 1_500_000]
    const d: DayAggregate = { ...day('20261005', TRUTH), keys: { 'T@TJ-S1@F': { 10: cell } } }
    expect(pooledCv(buildPool([d])).get(`T@F|${column('WD', 10)}`)).toBeCloseTo(0.5, 6)
  })
})

describe('backtest', () => {
  it('never trains on the held-out day', () => {
    // Day i has a distinctive amount of healthy time, so a leak is visible in the pool.
    const varied = dates.map((d, i) => day(d, TRUTH, 3600 + i * 100))
    const total = varied.reduce((a, d) => a + d.healthySecByHour[10]!, 0)
    const seen: number[] = []
    const spy = { name: 'spy', fit: (pool: ReturnType<typeof buildPool>) => {
      seen.push(pool.healthySec[10]!)
      return { headway: () => 300 }
    } }
    backtest(varied, [spy], () => 300, 'loo')
    expect(seen.sort((a, b) => a - b)).toEqual(varied.map(d => total - d.healthySecByHour[10]!).sort((a, b) => a - b))
  })

  it('rolling trains only on earlier days and skips folds with too little history', () => {
    const varied = dates.map((d, i) => day(d, TRUTH, 3600 + i * 100))
    const seen: number[] = []
    const spy = { name: 'spy', fit: (pool: ReturnType<typeof buildPool>) => {
      seen.push(pool.days)
      return { headway: () => 300 }
    } }
    backtest(varied, [spy], () => 300, 'rolling')
    expect(seen).toEqual([3, 4])
  })

  it('scores a perfect model at zero error and GTFS by its distance from truth', () => {
    const spec = { name: 'truth', fit: () => ({ headway: (key: string, _t: DayType, hour: number) => {
      const factor = FACTORS[key.split('@')[1]!.replace('TJ-', '') as keyof typeof FACTORS]
      return (hour === 10 ? 300 : 600) / factor
    } }) }
    const gtfs = () => 300
    const result = backtest(days, [spec, gtfsRawSpec(gtfs)], gtfs, 'loo')
    expect(result.models.truth!.median).toBeCloseTo(0, 6)
    expect(result.models.gtfsRaw!.median).toBeGreaterThan(0)
    expect(result.models.truth!.coverage).toBe(1)
  })
})

describe('vouchedColumns', () => {
  const summary = (n: number, model: number, baseline: number) => ({
    mode: 'loo' as const,
    folds: 1,
    truthBuckets: n,
    intersection: n,
    models: {},
    byColumn: { 10: { n, median: { m: model, b: baseline } } }
  })

  it('vouches only for columns with enough buckets where the model beats the baseline', () => {
    expect([...vouchedColumns(summary(MIN_VALIDATION_BUCKETS, 0.2, 0.3), 'm', 'b')]).toEqual([10])
    expect(vouchedColumns(summary(MIN_VALIDATION_BUCKETS - 1, 0.2, 0.3), 'm', 'b').size).toBe(0)
    expect(vouchedColumns(summary(1000, 0.4, 0.3), 'm', 'b').size).toBe(0)
  })
})

describe('renderOverlay', () => {
  const pool = buildPool(days)
  const model = fitFactorised(pool)
  const base = { model, pool, modelName: 'M2 factorised', range: { from: '20261005', to: '20261009' }, dayCounts: { WD: 5, WE: 0 }, backtestLines: ['Leave-one-day-out: test'], scales: [], interpolated: new Map() }

  it('writes sorted, clamped profile cells for vouched columns only', () => {
    const text = renderOverlay({ ...base, vouched: new Set([column('WD', 10)]) })
    expect(text).toContain(`'${profileKey('T@F', column('WD', 10))}': 300`)
    expect(text).not.toContain(`'${profileKey('T@F', column('WD', 11))}'`)
    expect(text).toContain('Hours present, WIB: weekday 10; weekend none.')
    expect(text).toContain('export const OBSERVED_STOP_FACTOR')
  })

  it('is deterministic', () => {
    const vouched = new Set([column('WD', 10), column('WD', 11)])
    expect(renderOverlay({ ...base, vouched })).toBe(renderOverlay({ ...base, vouched }))
  })
})
