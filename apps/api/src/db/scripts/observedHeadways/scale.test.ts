import { describe, expect, it } from 'vitest'
import { column, type FactorisedModel } from './fit'
import { CAP_QUANTILE, computeColumnScales, MIN_CAP_LINES, MIN_SCALE_RATIOS, plannerValue } from './scale'

/*
 * A model with `lines` line-directions, each having `stops` stops with factor 1,
 * a profile of `headwayS(line)` seconds in the given columns. Rates, as the
 * real model stores them (arrivals per second).
 */
function modelOf(opts: { lines: number, stops: number, columns: number[], headwayS: (line: number) => number }): FactorisedModel {
  const profile = new Map<string, number>()
  const factor = new Map<string, number>()
  for (let l = 0; l < opts.lines; l++) {
    for (const dir of ['F', 'R'] as const) {
      for (const c of opts.columns) profile.set(`L${l}@${dir}|${c}`, 1 / opts.headwayS(l))
      for (let s = 0; s < opts.stops; s++) factor.set(`L${l}@TJ-S${s}@${dir}`, 1)
    }
  }
  return { profile, factor, headway: () => undefined }
}

const WD10 = column('WD', 10)
const WD14 = column('WD', 14)
const schedule = () => 100

describe('plannerValue', () => {
  it('is the mean of the directions, clamped', () => {
    const model = modelOf({ lines: 1, stops: 1, columns: [WD10], headwayS: () => 400 })
    model.profile.set(`L0@R|${WD10}`, 1 / 600)
    expect(plannerValue(model, 'L0@TJ-S0', WD10)).toBe(500)
  })

  it('is undefined where neither direction has a profile and a factor', () => {
    const model = modelOf({ lines: 1, stops: 1, columns: [WD10], headwayS: () => 400 })
    expect(plannerValue(model, 'L0@TJ-S0', WD14)).toBeUndefined()
    expect(plannerValue(model, 'NOPE@TJ-S0', WD10)).toBeUndefined()
  })
})

describe('computeColumnScales', () => {
  // 10 lines x 3 stops: 30 ratios, enough to measure.
  const model = modelOf({ lines: 10, stops: 3, columns: [WD10, WD14], headwayS: l => 200 + l * 50 })

  it('measures the median observed / schedule ratio over stops', () => {
    const scales = computeColumnScales(model, new Set([WD10]), schedule)
    const wd10 = scales.find(s => s.id === 'WD:10')!
    expect(wd10.measured).toBe(true)
    // Observed 200..650 against a schedule of 100: median of 2.0..6.5 (30 values, 3 per line).
    expect(wd10.scale).toBeCloseTo(4.5, 6)
  })

  it('does not measure a column with fewer than MIN_SCALE_RATIOS stops', () => {
    const few = modelOf({ lines: 1, stops: MIN_SCALE_RATIOS - 1, columns: [WD10], headwayS: () => 300 })
    expect(computeColumnScales(few, new Set([WD10]), schedule)).toEqual([])
  })

  it('interpolates unvouched hours between measured ones and holds the end value', () => {
    const scales = computeColumnScales(model, new Set([WD10, WD14]), schedule)
    const at = (h: number) => scales.find(s => s.id === `WD:${h}`)!
    expect(at(10).measured).toBe(true)
    expect(at(12).measured).toBe(false)
    expect(at(12).scale).toBeCloseTo((at(10).scale + at(14).scale) / 2, 6)
    expect(at(3).scale).toBe(at(10).scale)
    expect(at(20).scale).toBe(at(14).scale)
  })

  it('emits a cap at the 90th percentile of the line-level headways', () => {
    const scales = computeColumnScales(model, new Set([WD10]), schedule)
    const levels = Array.from({ length: 10 }, (_, l) => 200 + l * 50)
    expect(scales.find(s => s.id === 'WD:10')!.cap).toBeCloseTo(levels[Math.floor(CAP_QUANTILE * (levels.length - 1))]!, 6)
  })

  it('leaves the cap absent when too few lines were measured to trust a percentile', () => {
    const narrow = modelOf({ lines: MIN_CAP_LINES - 1, stops: 10, columns: [WD10], headwayS: l => 200 + l * 50 })
    const wd10 = computeColumnScales(narrow, new Set([WD10]), schedule).find(s => s.id === 'WD:10')!
    expect(wd10.measured).toBe(true)
    expect(wd10.cap).toBeUndefined()
  })

  it('interpolates the cap the same way as the scale', () => {
    const scales = computeColumnScales(model, new Set([WD10, WD14]), schedule)
    const cap = (h: number) => scales.find(s => s.id === `WD:${h}`)!.cap!
    expect(cap(12)).toBeCloseTo((cap(10) + cap(14)) / 2, 6)
  })

  it('pools Saturday and Sunday references for the weekend columns', () => {
    const we = column('WE', 10)
    const weModel = modelOf({ lines: 10, stops: 3, columns: [we], headwayS: () => 400 })
    const seen: string[] = []
    computeColumnScales(weModel, new Set([we]), (day) => {
      seen.push(day)
      return 100
    })
    expect(new Set(seen)).toEqual(new Set(['SAT', 'SUN']))
  })
})
