import { describe, expect, it } from 'vitest'
import type { DayAggregate, DayType } from './aggregate'
import {
  backtest,
  heldBackCells,
  MIN_VALIDATION_BUCKETS,
  poissonDeviance,
  selectShippedCells,
  SPARSE_HEADWAY_S,
  vouchedColumns,
  vouchedStrata
} from './backtest'
import { column } from './fit'

/*
 * Synthetic days with a known truth: every key at the column runs a fixed
 * headway, so the exact expectation is the count. `quiet` keys had training
 * arrivals but none on the day they are scored, which is the sparse case the
 * old |log| score could never see.
 */
function day(
  date: string,
  keys: Record<string, number | undefined>,
  options: { healthy?: number, hour?: number, dayType?: DayType } = {}
): DayAggregate {
  const { healthy = 3600, hour = 10, dayType = 'WD' } = options
  const healthySecByHour = new Array<number>(24).fill(0)
  healthySecByHour[hour] = healthy
  const out: DayAggregate['keys'] = {}
  for (const [key, headway] of Object.entries(keys)) {
    if (headway === undefined) continue
    out[key] = { [hour]: [healthy / headway, 0, 0, 0] }
  }
  return { schema: 1, day: date, dayType, t0: 0, t1: 0, healthySecByHour, keys: out }
}

const dates = ['20261005', '20261006', '20261007', '20261008', '20261009']
const gtfs = () => 300
const manyStops = (n: number, headway: number, prefix = 'F') =>
  Object.fromEntries(Array.from({ length: n }, (_, i) => [`T@TJ-${prefix}${i}@F`, headway]))

describe('poissonDeviance', () => {
  it('is zero when the expected count equals the observed one', () => {
    expect(poissonDeviance(7, 7)).toBeCloseTo(0, 10)
  })

  it('charges an empty bucket twice the expected count', () => {
    expect(poissonDeviance(0, 3)).toBeCloseTo(6, 10)
  })

  it('matches the closed form for a non-trivial case', () => {
    // 2 * (4 ln(4/2) - 4 + 2)
    expect(poissonDeviance(4, 2)).toBeCloseTo(2 * (4 * Math.log(2) - 2), 10)
  })

  it('grows as the prediction moves away in either direction', () => {
    expect(poissonDeviance(5, 10)).toBeGreaterThan(poissonDeviance(5, 6))
    expect(poissonDeviance(5, 2)).toBeGreaterThan(poissonDeviance(5, 4))
  })
})

describe('strata', () => {
  const exact = { name: 'exact', fit: () => ({ headway: (key: string) => (key.includes('SPARSE') ? 1800 : 300) }) }
  const wrong = { name: 'wrong', fit: () => ({ headway: (key: string) => (key.includes('SPARSE') ? 400 : 3000) }) }
  const focus = { model: 'exact', baseline: 'wrong' }

  it('splits cells by what the model predicts, at SPARSE_HEADWAY_S', () => {
    const history = dates.map(d => day(d, { ...manyStops(40, 300), ...manyStops(40, 1800, 'SPARSE') }))
    const result = backtest(history, [exact, wrong], gtfs, 'loo', undefined, focus)
    const row = result.strata![column('WD', 10)]!
    expect(row.frequent.n).toBeGreaterThan(0)
    expect(row.sparse.n).toBeGreaterThan(0)
    expect(1800).toBeGreaterThanOrEqual(SPARSE_HEADWAY_S)
    expect(300).toBeLessThan(SPARSE_HEADWAY_S)
  })

  it('scores a key with training arrivals but none on the held-out day (the sparse case)', () => {
    // QUIET runs on four days and is absent on the fifth: that fold scores it as zero.
    const history = dates.map((d, i) => day(d, { ...manyStops(10, 300), 'T@TJ-QUIET@F': i === 4 ? undefined : 1800 }))
    const result = backtest(history, [exact, wrong], gtfs, 'loo', undefined, focus)
    const withQuiet = result.strata![column('WD', 10)]!
    const without = backtest(
      dates.map(d => day(d, manyStops(10, 300))), [exact, wrong], gtfs, 'loo', undefined, focus
    ).strata![column('WD', 10)]!
    expect(withQuiet.sparse.n + withQuiet.frequent.n).toBeGreaterThan(without.sparse.n + without.frequent.n)
  })

  it('scores only the buckets both models predicted', () => {
    const abstains = { name: 'abstains', fit: () => ({ headway: () => undefined }) }
    const history = dates.map(d => day(d, manyStops(20, 300)))
    const result = backtest(history, [exact, abstains], gtfs, 'loo', undefined, { model: 'exact', baseline: 'abstains' })
    const row = result.strata?.[column('WD', 10)]
    expect((row?.frequent.n ?? 0) + (row?.sparse.n ?? 0)).toBe(0)
  })

  it('vouches a stratum only with enough buckets and a lower deviance', () => {
    // 40 stops x 5 days of loo = 200 frequent buckets: past the bar.
    const history = dates.map(d => day(d, manyStops(40, 300)))
    const result = backtest(history, [exact, wrong], gtfs, 'loo', undefined, focus)
    const verdict = vouchedStrata(result).get(column('WD', 10))
    expect(result.strata![column('WD', 10)]!.frequent.n).toBeGreaterThanOrEqual(MIN_VALIDATION_BUCKETS)
    expect(verdict).toEqual({ frequent: true, sparse: false })

    // The same model against a baseline that is better is not vouched, however many buckets.
    const reversed = backtest(history, [wrong, exact], gtfs, 'loo', undefined, { model: 'wrong', baseline: 'exact' })
    expect(vouchedStrata(reversed).has(column('WD', 10))).toBe(false)
  })

  it('does not vouch a stratum that is short of the bar even when the model wins every bucket', () => {
    const history = dates.map(d => day(d, manyStops(5, 300)))
    const result = backtest(history, [exact, wrong], gtfs, 'loo', undefined, focus)
    expect(result.strata![column('WD', 10)]!.frequent.n).toBeLessThan(MIN_VALIDATION_BUCKETS)
    expect(vouchedStrata(result).size).toBe(0)
  })

  it('judges the sparse stratum on its own, so frequent wins cannot carry it', () => {
    // exact wins the frequent keys; on the sparse ones `bad` predicts correctly and `exact` is the loser.
    const sparseBad = { name: 'sparseBad', fit: () => ({ headway: (key: string) => (key.includes('SPARSE') ? 900 : 300) }) }
    const sparseGood = { name: 'sparseGood', fit: () => ({ headway: (key: string) => (key.includes('SPARSE') ? 1800 : 600) }) }
    const history = dates.map(d => day(d, { ...manyStops(40, 300), ...manyStops(40, 1800, 'SPARSE') }))
    const result = backtest(history, [sparseBad, sparseGood], gtfs, 'loo', undefined, { model: 'sparseBad', baseline: 'sparseGood' })
    const verdict = vouchedStrata(result).get(column('WD', 10))
    // sparseBad predicts 900 (>= the threshold, so sparse) and is worse than sparseGood's 1800 there;
    // it predicts 300 on frequent keys, better than 600.
    expect(verdict?.frequent).toBe(true)
    expect(verdict?.sparse).toBe(false)
  })

  it('puts a key in the stratum of the cell that ships for it, when the model says which', () => {
    // The stop's own value is sparse (1000 s), but it ships as part of a 300 s
    // line-direction profile, so that is the verdict that applies to it.
    const factored = { name: 'factored', fit: () => ({ headway: () => 1000, stratumHeadway: () => 300 }) }
    const history = dates.map(d => day(d, manyStops(40, 1000)))
    const row = backtest(history, [factored, wrong], gtfs, 'loo', undefined, { model: 'factored', baseline: 'wrong' }).strata![column('WD', 10)]!
    expect(row.frequent.n).toBeGreaterThan(0)
    expect(row.sparse.n).toBe(0)
  })

  it('reports the columns with any vouched stratum', () => {
    const history = dates.map(d => day(d, manyStops(40, 300)))
    const result = backtest(history, [exact, wrong], gtfs, 'loo', undefined, focus)
    expect([...vouchedColumns(result, 'exact', 'wrong')]).toEqual([column('WD', 10)])
  })
})

describe('selectShippedCells', () => {
  const rates = new Map([
    ['1@F|10', 1 / 300], // frequent
    ['1@R|10', 1 / 1800], // sparse
    ['2@F|11', 1 / 300],
    ['2@R|11', 1 / 1800]
  ])

  it('ships each cell by its own stratum', () => {
    const strata = new Map([[10, { frequent: true, sparse: false }]])
    expect([...selectShippedCells(rates, strata)]).toEqual(['1@F|10'])
  })

  it('ships both strata of a column that earned both, and nothing from an unvouched column', () => {
    const strata = new Map([[10, { frequent: true, sparse: true }]])
    expect([...selectShippedCells(rates, strata)].sort()).toEqual(['1@F|10', '1@R|10'])
  })

  it('classifies at exactly SPARSE_HEADWAY_S as sparse', () => {
    const edge = new Map([['3@F|10', 1 / SPARSE_HEADWAY_S]])
    expect(selectShippedCells(edge, new Map([[10, { frequent: true, sparse: false }]])).size).toBe(0)
    expect(selectShippedCells(edge, new Map([[10, { frequent: false, sparse: true }]])).size).toBe(1)
  })
})

describe('the with-buses guard', () => {
  // A model that predicts less service than the fallback everywhere wins every
  // empty bucket. Quiet keys run on exactly one of the five days, so each is empty
  // in the four folds that hold another day out; the always-running keys are the
  // ones that expose it.
  const underPredicts = { name: 'under', fit: () => ({ headway: () => 1800 }) }
  const fallback = { name: 'fallback', fit: () => ({ headway: () => 300 }) }
  const quiet = (n: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`T@TJ-Q${i}@F`, 300]))

  const history = dates.map((d, i) => {
    const keys: Record<string, number | undefined> = { ...manyStops(40, 300) }
    // 400 quiet keys, each present on exactly one day (rotating).
    for (const [key, headway] of Object.entries(quiet(400))) {
      const n = Number(key.slice(key.indexOf('Q') + 1, key.indexOf('@F')))
      keys[key] = n % 5 === i ? headway : undefined
    }
    return day(d, keys)
  })

  it('would vouch the under-predicting model on pooled deviance alone', () => {
    const result = backtest(history, [underPredicts, fallback], gtfs, 'loo', undefined, { model: 'under', baseline: 'fallback' })
    const sparse = result.strata![column('WD', 10)]!.sparse
    expect(sparse.n).toBeGreaterThanOrEqual(MIN_VALIDATION_BUCKETS)
    // It wins pooled (the empties) ...
    expect(sparse.devModel).toBeLessThan(sparse.devBaseline)
    // ... and loses where buses ran.
    expect(sparse.nBuses).toBeGreaterThan(0)
    expect(sparse.devModelBuses / sparse.nBuses).toBeGreaterThan(sparse.devBaselineBuses / sparse.nBuses)
  })

  it('does not vouch it, because it is worse where buses ran', () => {
    const result = backtest(history, [underPredicts, fallback], gtfs, 'loo', undefined, { model: 'under', baseline: 'fallback' })
    expect(vouchedStrata(result).get(column('WD', 10))?.sparse ?? false).toBe(false)
  })

  it('still vouches a model that is better where buses ran', () => {
    // Sparse keys that genuinely run every 30 minutes, predicted correctly, against a baseline
    // that says every 50: better pooled and better where buses ran, so it must ship.
    const sparseKeys = dates.map(d => day(d, manyStops(40, 1800, 'SPARSE')))
    const right = { name: 'right', fit: () => ({ headway: () => 1800 }) }
    const wrong = { name: 'wrong', fit: () => ({ headway: () => 3000 }) }
    const result = backtest(sparseKeys, [right, wrong], gtfs, 'loo', undefined, { model: 'right', baseline: 'wrong' })
    expect(vouchedStrata(result).get(column('WD', 10))?.sparse).toBe(true)
  })
})

describe('heldBackCells', () => {
  const history = dates.map(d => day(d, { ...manyStops(40, 300), ...manyStops(40, 1800, 'SPARSE') }))
  // Wins frequent, loses sparse (it says 900 where the truth and the baseline say 1800).
  const sparseBad = { name: 'sparseBad', fit: () => ({ headway: (key: string) => (key.includes('SPARSE') ? 900 : 300) }) }
  const sparseGood = { name: 'sparseGood', fit: () => ({ headway: (key: string) => (key.includes('SPARSE') ? 1800 : 600) }) }
  const result = backtest(history, [sparseBad, sparseGood], gtfs, 'loo', undefined, { model: 'sparseBad', baseline: 'sparseGood' })
  const c = column('WD', 10)

  it('holds back a cell whose stratum was scored and lost, and not one whose stratum won', () => {
    const rates = new Map([[`T@F|${c}`, 1 / 300], [`T@R|${c}`, 1 / 1200]])
    expect([...heldBackCells(rates, result)]).toEqual([`T@R|${c}`])
  })

  it('does not hold back a cell in a stratum too thin to score, or in a column with no stats', () => {
    const thin = backtest(dates.map(d => day(d, manyStops(5, 1800, 'SPARSE'))), [sparseBad, sparseGood], gtfs, 'loo', undefined, { model: 'sparseBad', baseline: 'sparseGood' })
    expect(thin.strata![c]!.sparse.n).toBeLessThan(MIN_VALIDATION_BUCKETS)
    expect(heldBackCells(new Map([[`T@R|${c}`, 1 / 1200]]), thin).size).toBe(0)
    expect(heldBackCells(new Map([[`T@R|${column('WD', 3)}`, 1 / 1200]]), result).size).toBe(0)
  })
})
