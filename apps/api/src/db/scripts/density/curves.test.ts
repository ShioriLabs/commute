import { describe, expect, it } from 'vitest'
import { RIDER_CURVES } from '../../data/rider-curves'
import { normalize, reweightMorning, shiftAm, withAmShare } from './curves'

const sum = (c: number[]) => c.reduce((a, b) => a + b, 0)
const shareBefore = (c: number[], h: number) => sum(c.slice(0, h)) / sum(c)

describe('RIDER_CURVES', () => {
  it('has 24 hours per operator, summing to ~1', () => {
    for (const curve of Object.values(RIDER_CURVES)) {
      expect(curve).toHaveLength(24)
      expect(sum([...curve])).toBeCloseTo(1, 2)
    }
  })
})

describe('normalize', () => {
  it('scales to sum 1 and leaves an all-zero curve all-zero', () => {
    expect(sum(normalize([1, 1, 2]))).toBeCloseTo(1)
    expect(normalize([0, 0])).toEqual([0, 0])
  })
})

describe('reweightMorning', () => {
  it('hits the target share before the cut-off and keeps the within-half shape', () => {
    const kci = reweightMorning([...RIDER_CURVES.KCI], 10, 0.35)
    expect(shareBefore(kci, 10)).toBeCloseTo(0.35, 3)
    expect(sum(kci)).toBeCloseTo(1, 6)
    // 07h stays the morning maximum: only scaled, never reshaped.
    const morning = kci.slice(0, 10)
    expect(morning.indexOf(Math.max(...morning))).toBe(7)
  })
})

describe('withAmShare', () => {
  it('sets the share of the day before 13:00', () => {
    const c = withAmShare([...RIDER_CURVES.KCI], 0.58)
    expect(shareBefore(c, 13)).toBeCloseTo(0.58, 3)
    expect(sum(c)).toBeCloseTo(1, 6)
  })
})

describe('shiftAm', () => {
  it('moves the morning peak earlier by whole hours and leaves the evening alone', () => {
    const c = shiftAm([...RIDER_CURVES.MRTJ], 1)
    const morning = c.slice(0, 13)
    expect(morning.indexOf(Math.max(...morning))).toBe(6) // MRT peaks at 07h, so 06h after the shift
    const evening = [...RIDER_CURVES.MRTJ].slice(13).map(x => x / sum([...RIDER_CURVES.MRTJ]))
    c.slice(13).forEach((x, i) => expect(x).toBeCloseTo(evening[i]!, 12))
  })

  it('interpolates fractional shifts and keeps the total', () => {
    const c = shiftAm([...RIDER_CURVES.KCI], 0.5)
    expect(sum(c)).toBeCloseTo(1, 6)
  })
})
