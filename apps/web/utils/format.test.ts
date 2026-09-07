import { describe, expect, it } from 'vitest'
import { formatClock, formatKm, formatRupiah } from './format'

describe('formatRupiah', () => {
  it('renders whole rupiah with no fractional part', () => {
    // The tariff has no sub-rupiah precision, so a ",00" would overstate it.
    expect(formatRupiah(14000)).not.toContain(',00')
  })

  it('groups thousands and carries the currency marker', () => {
    const formatted = formatRupiah(14000)
    expect(formatted).toContain('14')
    expect(formatted).toMatch(/Rp/)
  })

  it('formats zero rather than falling back to an empty string', () => {
    expect(formatRupiah(0)).toMatch(/Rp/)
  })

  it('rounds rather than truncating', () => {
    // Guards the maximumFractionDigits: 0 setting: 2500.6 must not read 2.500.
    expect(formatRupiah(2500.6)).toContain('2.501')
  })

  it('has no space between the currency marker and the amount', () => {
    expect(formatRupiah(14000)).toBe('Rp14.000')
  })
})

describe('formatKm', () => {
  it('converts metres to kilometres at one decimal', () => {
    expect(formatKm(1500)).toBe('1,5 km')
  })

  it('drops the decimal when the value is whole', () => {
    expect(formatKm(2000)).toBe('2 km')
  })

  it('rounds to one decimal rather than showing walking-scale noise', () => {
    expect(formatKm(1234)).toBe('1,2 km')
  })

  it('renders sub-kilometre distances without a leading zero problem', () => {
    expect(formatKm(634)).toBe('0,6 km')
  })

  it('handles zero', () => {
    expect(formatKm(0)).toBe('0 km')
  })
})

describe('formatClock', () => {
  it('renders a Jakarta wall clock with the dot separator', () => {
    // id-ID uses a dot, matching the station departure board and timetable.
    expect(formatClock('2026-09-07T07:14:00+07:00')).toBe('07.14')
    expect(formatClock('2026-09-07T19:05:00+07:00')).toBe('19.05')
  })

  /*
   * Pinned to Asia/Jakarta rather than the device: a rider abroad checking a
   * Jakarta journey wants the time on the platform sign, not their own.
   */
  it('reads in Jakarta time whatever zone the instant is written in', () => {
    expect(formatClock('2026-09-07T00:14:00+00:00')).toBe('07.14')
  })

  // A journey the engine reported past midnight arrives as the next day's
  // instant, so the clock reads 00.23 rather than 24.23.
  it('shows a past-midnight arrival as a small-hours time', () => {
    expect(formatClock('2026-09-08T00:23:00+07:00')).toBe('00.23')
  })
})
