import { describe, expect, it } from 'vitest'
import type { DayAggregate } from './aggregate'
import { serviceDayOf } from './aggregate'
import { shippedFallbackSpec } from './fallback'
import { buildPool } from './fit'

/*
 * The backtest baseline must be what a rider would be shown instead: the
 * runtime's scaled schedule, from scales fitted on the TRAINING days only.
 */
function day(date: string, headwayFor: (line: number) => number): DayAggregate {
  const healthySecByHour = new Array<number>(24).fill(0)
  healthySecByHour[10] = 3600
  const keys: DayAggregate['keys'] = {}
  for (let l = 0; l < 10; l++) {
    for (const dir of ['F', 'R'] as const) {
      for (let s = 0; s < 6; s++) keys[`L${l}@TJ-S${s}@${dir}`] = { 10: [3600 / headwayFor(l), 0, 0, 0] }
    }
  }
  return { schema: 1, day: date, dayType: 'WD', t0: 0, t1: 0, healthySecByHour, keys }
}

// 10 lines x 6 stops, enough arrivals per stop (>= 30 over the days) to clear the fit's floors.
const DATES = ['20261005', '20261006', '20261007', '20261008', '20261009']
const training = DATES.map(d => day(d, l => 200 + l * 30))
const pool = buildPool(training)

describe('shippedFallbackSpec', () => {
  it('reads the schedule of the held-out day\'s service day', () => {
    const seen: string[] = []
    const spec = shippedFallbackSpec({
      base: (d) => {
        seen.push(d)
        return 100
      },
      baseDir: () => undefined,
      serviceDayOf
    })
    const model = spec.fit(pool, { day: '20261010', dayType: 'WE' }) // a Saturday
    model.headway('L0@TJ-S0@F', 'WD', 10)
    expect(seen.at(-1)).toBe('SAT')

    seen.length = 0
    spec.fit(pool, { day: '20261011', dayType: 'WE' }).headway('L0@TJ-S0@F', 'WD', 10) // a Sunday
    expect(seen.at(-1)).toBe('SUN')
  })

  it('treats a public holiday as SUN, as the runtime does', () => {
    expect(serviceDayOf('20261225')).toBe('SUN')
    expect(serviceDayOf('20261010')).toBe('SAT')
    expect(serviceDayOf('20261012')).toBe('WD')
  })

  it('never goes below the schedule value, and is undefined without one', () => {
    const spec = shippedFallbackSpec({ base: () => 9000, baseDir: () => undefined, serviceDayOf })
    const model = spec.fit(pool, { day: '20261005', dayType: 'WD' })
    // The measured scale is far below 1 (modelled ~300 against a 9000 schedule), so the
    // scaled value is ~300; the schedule itself is the floor, which clamps to 3600.
    expect(model.headway('L0@TJ-S0@F', 'WD', 10)).toBe(3600)
    const none = shippedFallbackSpec({ base: () => undefined, baseDir: () => undefined, serviceDayOf })
    expect(none.fit(pool, { day: '20261005', dayType: 'WD' }).headway('L0@TJ-S0@F', 'WD', 10)).toBeUndefined()
  })

  it('uses the directional scale against directional schedule values', () => {
    // Directional schedule values 1.5x the pooled ones: the directional scale is smaller, so the
    // two paths land on about the same modelled level instead of the directional one overshooting.
    const spec = shippedFallbackSpec({
      base: () => 100,
      baseDir: key => (key.endsWith('@F') ? 150 : undefined),
      serviceDayOf
    })
    const model = spec.fit(pool, { day: '20261005', dayType: 'WD' })
    const pooled = model.headway('L0@TJ-S0@R', 'WD', 10)!
    const directional = model.headway('L0@TJ-S0@F', 'WD', 10)!
    expect(Math.abs(Math.log(directional / pooled))).toBeLessThan(0.1)
  })

  it('is fitted from the training pool it is given, not from anywhere else', () => {
    const slow = buildPool(DATES.map(d => day(d, () => 450)))
    const spec = shippedFallbackSpec({ base: () => 100, baseDir: () => undefined, serviceDayOf })
    const fast = spec.fit(pool, { day: '20261005', dayType: 'WD' }).headway('L0@TJ-S0@F', 'WD', 10)!
    const slower = spec.fit(slow, { day: '20261005', dayType: 'WD' }).headway('L0@TJ-S0@F', 'WD', 10)!
    expect(slower).toBeGreaterThan(fast)
  })
})
