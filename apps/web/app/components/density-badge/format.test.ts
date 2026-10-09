import { describe, expect, it } from 'vitest'
import type { StationDensity } from '@commute/schemas'
import { currentHourRange, densityHour, densityLabel } from './format'

const density = (day: StationDensity['day']): StationDensity => ({
  day,
  hours: Array.from({ length: 24 }, (_, hour) => {
    if (hour === 0) return { hour, level: { min: 2, max: 2 } }
    if (hour === 18) return { hour, level: { min: 2, max: 3 } }
    return { hour, level: null }
  })
})

describe('densityLabel', () => {
  it('names a single level when the range is closed', () => {
    expect(densityLabel({ min: 0, max: 0 })).toBe('Biasanya lengang jam segini')
    expect(densityLabel({ min: 1, max: 1 })).toBe('Biasanya ramai jam segini')
    expect(densityLabel({ min: 2, max: 2 })).toBe('Biasanya padat jam segini')
    expect(densityLabel({ min: 3, max: 3 })).toBe('Biasanya sangat padat jam segini')
  })

  it('spells out an open range', () => {
    expect(densityLabel({ min: 2, max: 3 })).toBe('Biasanya padat sampai sangat padat jam segini')
    expect(densityLabel({ min: 0, max: 1 })).toBe('Biasanya lengang sampai ramai jam segini')
  })

  it('speaks in the typically register, with no trailing period or em dash', () => {
    for (let min = 0; min <= 3; min++) {
      for (let max = min; max <= 3; max++) {
        const label = densityLabel({ min, max })!
        expect(label.startsWith('Biasanya ')).toBe(true)
        expect(label).not.toMatch(/\.$|—/)
      }
    }
  })

  it('renders nothing for a null range', () => {
    expect(densityLabel(null)).toBeNull()
  })
})

describe('currentHourRange', () => {
  it('reads the current clock hour', () => {
    expect(currentHourRange(density('WD'), new Date(2026, 9, 7, 18, 30))).toEqual({ min: 2, max: 3 })
  })

  it('uses the service day across midnight: 00:30 Saturday reads the board the page fetched for Friday', () => {
    // station-content fetches ?day=serviceDayOf(now), which is WD at 00:30 Sat; hour stays 0.
    expect(densityHour(new Date(2026, 9, 10, 0, 30))).toBe(0)
    expect(currentHourRange(density('WD'), new Date(2026, 9, 10, 0, 30))).toEqual({ min: 2, max: 2 })
  })

  it('is null while loading and for an hour without an estimate', () => {
    expect(currentHourRange(undefined, new Date())).toBeNull()
    expect(currentHourRange(density('WD'), new Date(2026, 9, 7, 3, 0))).toBeNull()
  })
})
