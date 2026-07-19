import { describe, expect, it } from 'vitest'
import { getMRTJFare } from 'operators/mrtj/fares'

describe('getMRTJFare', () => {
  it('resolves a forward (stored-direction) pair', () => {
    expect(getMRTJFare('LBB', 'FTM')).toBe(4000)
  })

  it('falls back to the reverse direction', () => {
    // FTM->LBB is not stored; the reverse LBB->FTM (4000) should be used.
    expect(getMRTJFare('FTM', 'LBB')).toBe(4000)
  })

  it('resolves an interior pair in both directions', () => {
    expect(getMRTJFare('CPR', 'BHI')).toBe(11000)
    expect(getMRTJFare('BHI', 'CPR')).toBe(11000)
  })

  it('resolves the minimum-boundary fare (3000)', () => {
    expect(getMRTJFare('CPR', 'HJN')).toBe(3000)
  })

  it('resolves the maximum-boundary fare (14000)', () => {
    expect(getMRTJFare('LBB', 'DKA')).toBe(14000)
  })

  it('returns null for the same station (no self-pair)', () => {
    expect(getMRTJFare('LBB', 'LBB')).toBe(null)
  })

  it('returns null when the from-code is unknown', () => {
    expect(getMRTJFare('XXX', 'FTM')).toBe(null)
  })

  it('returns null when the to-code is unknown', () => {
    expect(getMRTJFare('LBB', 'XXX')).toBe(null)
  })

  it('returns null when both codes are unknown', () => {
    expect(getMRTJFare('XXX', 'YYY')).toBe(null)
  })

  it('returns null for empty strings', () => {
    expect(getMRTJFare('', '')).toBe(null)
  })
})
