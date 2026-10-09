import { describe, expect, it } from 'vitest'
import { boardingsPerDay, hourlyLevels, levelOf, LEVEL_THRESHOLDS, type LevelRange, type StationInput } from './model'

const flat = (n: number, from = 5, to = 23) => Array.from({ length: 24 }, (_, h) => h >= from && h < to ? n : 0)

const input = (over: Partial<StationInput> = {}): StationInput => ({
  stationId: 'KCI-XXX', operator: 'KCI', score: 60, rideMin: 40,
  departures: { WD: flat(20), SAT: flat(18), SUN: flat(18) },
  ...over
})

const maxOf = (levels: LevelRange[]) => Math.max(...levels.map(l => l?.max ?? -1))
const width = (levels: LevelRange[]) => levels.reduce((w, l) => w + (l ? l.max - l.min : 0), 0)

describe('boardingsPerDay', () => {
  it('counts half the gate taps plus every transfer for an anchored station', () => {
    expect(boardingsPerDay({ gatePerDay: 30_000, transitPerDay: 150_000 } as never, 0)).toBe(165_000)
  })

  it('inverts the measured score scale when there is no anchor', () => {
    // score 100 sits at DEMAND_CEIL (250,000 in+out) → 125,000 boardings
    expect(boardingsPerDay(undefined, 100)).toBeCloseTo(125_000, -2)
    expect(boardingsPerDay(undefined, 0)).toBeCloseTo(250, -1)
  })
})

describe('levelOf', () => {
  it('maps load to 0 Lengang .. 3 Sangat Padat at the thresholds', () => {
    expect(levelOf(0)).toBe(0)
    expect(levelOf(LEVEL_THRESHOLDS[0])).toBe(1)
    expect(levelOf(LEVEL_THRESHOLDS[1])).toBe(2)
    expect(levelOf(LEVEL_THRESHOLDS[2])).toBe(3)
    expect(levelOf(LEVEL_THRESHOLDS[2] * 10)).toBe(3)
  })
})

describe('hourlyLevels', () => {
  it('returns 24 entries', () => {
    expect(hourlyLevels(input(), 'WD')).toHaveLength(24)
  })

  it('masks hours without service as null, never as Lengang', () => {
    const levels = hourlyLevels(input(), 'WD')
    expect(levels[3]).toBeNull()
    expect(levels[23]).toBeNull()
  })

  it('masks thin hours under a quarter of peak departures', () => {
    const deps = flat(20)
    deps[5] = 4
    expect(hourlyLevels(input({ departures: { WD: deps, SAT: deps, SUN: deps } }), 'WD')[5]).toBeNull()
  })

  it('is all null for a day without service', () => {
    const s = input({ departures: { WD: flat(20), SAT: flat(0), SUN: flat(0) } })
    expect(hourlyLevels(s, 'SUN').every(l => l === null)).toBe(true)
  })

  it('always has min ≤ max', () => {
    for (const day of ['WD', 'SAT', 'SUN'] as const) {
      for (const l of hourlyLevels(input({ rideMin: 0, score: 90 }), day)) {
        if (l) expect(l.min).toBeLessThanOrEqual(l.max)
      }
    }
  })

  it('is at least as uncertain for a score-only station as for an anchored twin', () => {
    const score = 70
    const twin = { stationId: 'KCI-XXX', period: 'test', published: 'test', source: 'test', gatePerDay: 2 * boardingsPerDay(undefined, score) }
    const scored = hourlyLevels(input({ score }), 'WD')
    const anchored = hourlyLevels(input({ score, anchor: twin }), 'WD')
    expect(width(scored)).toBeGreaterThanOrEqual(width(anchored))
  })

  it('is busier in the evening peak than at midday for a business station', () => {
    const levels = hourlyLevels(input({ rideMin: 0, score: 90 }), 'WD')
    expect(levels[18]!.max).toBeGreaterThan(levels[11]!.max)
  })

  it('is never busier at the weekend than on a weekday for a business station', () => {
    const s = input({ rideMin: 0, score: 90 })
    expect(maxOf(hourlyLevels(s, 'SAT'))).toBeLessThanOrEqual(maxOf(hourlyLevels(s, 'WD')))
  })
})
