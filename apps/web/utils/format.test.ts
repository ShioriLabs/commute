import { describe, expect, it } from 'vitest'
import { formatKm, formatRupiah } from './format'

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
