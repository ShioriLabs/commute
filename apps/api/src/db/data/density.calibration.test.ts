import { describe, expect, it } from 'vitest'
import { DENSITY_LEVELS } from './density'

type Day = 'WD' | 'SAT' | 'SUN'
const digit = (id: string, day: Day, side: 'min' | 'max', h: number) => DENSITY_LEVELS[id]?.[day]?.[side][h] ?? '-'
/** Busy claims read the top of the range; -1 when there is no estimate. */
const high = (id: string, day: Day, h: number) => Number(digit(id, day, 'max', h).replace('-', '-1'))
/** Quiet claims read the bottom of the range; 4 when there is no estimate, so it never passes as quiet. */
const low = (id: string, day: Day, h: number) => Number(digit(id, day, 'min', h).replace('-', '4'))

/*
 * What the spec says a rider should see. Each line cites the evidence it encodes
 * (docs/station-density.md). These are the acceptance criteria for the model:
 * tune the model, never these. Levels: 0 Lengang, 1 Ramai, 2 Padat, 3 Sangat Padat.
 * A busy claim holds when the range reaches it (max), a quiet one only when the
 * whole range sits there (max), a "not quiet" one when the range never dips into Lengang (min).
 */
describe('density calibration', () => {
  it('Manggarai is very busy in the weekday evening peak and not quiet at midday', () => {
    expect(high('KCI-MRI', 'WD', 17)).toBe(3)
    expect(low('KCI-MRI', 'WD', 12)).toBeGreaterThanOrEqual(1)
  })

  it('Sudirman: the weekday evening is its crowd, the morning is not (evening boarding, morning alighting)', () => {
    expect(high('KCI-SUD', 'WD', 18)).toBe(3)
    expect(high('KCI-SUD', 'WD', 7)).toBeLessThan(high('KCI-SUD', 'WD', 18))
  })

  it('Bogor boards in the weekday morning', () => {
    expect(low('KCI-BOO', 'WD', 6)).toBeGreaterThanOrEqual(2)
  })

  it('business stations calm down at weekends far more than origins do', () => {
    expect(high('KCI-SUD', 'SUN', 18)).toBeLessThan(high('KCI-SUD', 'WD', 18))
    expect(high('KCI-BOO', 'SUN', 17)).toBeGreaterThanOrEqual(2)
  })

  it('Dukuh Atas BNI (MRT) is busy at the weekday morning peak and quiet at midday', () => {
    expect(high('MRTJ-DKA', 'WD', 7)).toBeGreaterThanOrEqual(2)
    expect(high('MRTJ-DKA', 'WD', 12)).toBeLessThanOrEqual(1)
  })

  it('Tebet is not a quiet station at the weekday evening peak (KCI release: ~19.4k arriving by 13:00, as many as Gondangdia)', () => {
    expect(high('KCI-TEB', 'WD', 17)).toBeGreaterThanOrEqual(2)
    expect(low('KCI-TEB', 'WD', 17)).toBeGreaterThanOrEqual(1)
  })

  it('nothing has an estimate at 03h on any day', () => {
    for (const days of Object.values(DENSITY_LEVELS)) {
      for (const d of Object.values(days)) {
        expect(d!.min[3]).toBe('-')
        expect(d!.max[3]).toBe('-')
      }
    }
  })

  it('every range is well formed: min ≤ max, and both null or neither', () => {
    for (const days of Object.values(DENSITY_LEVELS)) {
      for (const d of Object.values(days)) {
        for (let h = 0; h < 24; h++) {
          expect(d!.min[h] === '-').toBe(d!.max[h] === '-')
          if (d!.min[h] !== '-') expect(Number(d!.min[h])).toBeLessThanOrEqual(Number(d!.max[h]))
        }
      }
    }
  })

  it('not everything is Sangat Padat: under a quarter of weekday station-hours with service reach level 3', () => {
    const all = Object.values(DENSITY_LEVELS).flatMap(d => (d.WD?.max ?? '').split('')).filter(c => c !== '-')
    expect(all.filter(c => c === '3').length / all.length).toBeLessThan(0.25)
  })
})
