import { describe, expect, it } from 'vitest'
import { column } from './fit'
import { HOLD_HOURS, interpolateProfiles, MAX_GAP_HOURS } from './interpolate'

const cell = (lineDir: string, dayType: 'WD' | 'WE', hour: number) => `${lineDir}|${column(dayType, hour)}`

describe('interpolateProfiles', () => {
  const measured = new Map([
    [cell('1@F', 'WD', 6), 200],
    [cell('1@F', 'WD', 8), 300],
    [cell('1@F', 'WD', 10), 250]
  ])

  it('fills a hour between two measured hours linearly in headway', () => {
    const out = interpolateProfiles(measured)
    expect(out.get(cell('1@F', 'WD', 7))).toBe(250)
    expect(out.get(cell('1@F', 'WD', 9))).toBe(275)
  })

  it('never alters or re-emits a measured cell', () => {
    const out = interpolateProfiles(measured)
    for (const id of measured.keys()) expect(out.has(id)).toBe(false)
  })

  it('holds the nearest value for a short way past the first and last hour, then stops', () => {
    const out = interpolateProfiles(measured)
    expect(out.get(cell('1@F', 'WD', 6 - HOLD_HOURS))).toBe(200)
    expect(out.has(cell('1@F', 'WD', 6 - HOLD_HOURS - 1))).toBe(false)
    expect(out.get(cell('1@F', 'WD', 10 + HOLD_HOURS))).toBe(250)
    expect(out.has(cell('1@F', 'WD', 10 + HOLD_HOURS + 1))).toBe(false)
  })

  it('refuses to bridge a gap wider than MAX_GAP_HOURS', () => {
    const wide = new Map([
      [cell('2@F', 'WD', 5), 200],
      [cell('2@F', 'WD', 5 + MAX_GAP_HOURS + 1), 600]
    ])
    expect(interpolateProfiles(wide).has(cell('2@F', 'WD', 8))).toBe(false)
  })

  it('bridges a gap of exactly MAX_GAP_HOURS', () => {
    const edge = new Map([
      [cell('2@F', 'WD', 5), 200],
      [cell('2@F', 'WD', 5 + MAX_GAP_HOURS), 800]
    ])
    expect(interpolateProfiles(edge).get(cell('2@F', 'WD', 8))).toBeCloseTo(200 + (600 * 3) / MAX_GAP_HOURS, 6)
  })

  it('keeps line-directions and day types apart', () => {
    const mixed = new Map([
      [cell('1@F', 'WD', 6), 100],
      [cell('1@R', 'WD', 8), 900],
      [cell('1@F', 'WE', 8), 500]
    ])
    const out = interpolateProfiles(mixed)
    // 1@F weekday has only hour 6: held, not blended with 1@R or the weekend.
    expect(out.get(cell('1@F', 'WD', 7))).toBe(100)
    expect(out.get(cell('1@R', 'WD', 7))).toBe(900)
    expect(out.get(cell('1@F', 'WE', 7))).toBe(500)
  })
})
