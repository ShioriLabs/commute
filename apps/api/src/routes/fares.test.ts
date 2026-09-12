import { describe, expect, it } from 'vitest'
import { fareCacheKey, parseFareContext } from 'routes/fares'

describe('parseFareContext', () => {
  it('defaults to stored value + now when no params given', () => {
    const before = Date.now()
    const ctx = parseFareContext(undefined, undefined)
    expect(ctx.paymentMethod).toBe('STORED_VALUE')
    expect(ctx.departureAt.getTime()).toBeGreaterThanOrEqual(before)
  })

  it('accepts a known payment method and ISO departure time', () => {
    const ctx = parseFareContext('JAKLINGKO', '2026-07-20T08:00:00+07:00')
    expect(ctx.paymentMethod).toBe('JAKLINGKO')
    expect(ctx.departureAt.toISOString()).toBe('2026-07-20T01:00:00.000Z')
  })

  it('accepts QRIS_TAP', () => {
    expect(parseFareContext('QRIS_TAP', undefined).paymentMethod).toBe('QRIS_TAP')
  })

  it('falls back to defaults for unknown method / malformed time', () => {
    const before = Date.now()
    const ctx = parseFareContext('FOO', 'nonsense')
    expect(ctx.paymentMethod).toBe('STORED_VALUE')
    expect(ctx.departureAt.getTime()).toBeGreaterThanOrEqual(before)
  })
})

describe('fareCacheKey', () => {
  const peak = { paymentMethod: 'STORED_VALUE', departureAt: new Date('2026-07-20T08:00:00+07:00') } as const
  const offpeak = { paymentMethod: 'STORED_VALUE', departureAt: new Date('2026-07-20T12:00:00+07:00') } as const
  const jaklingko = { paymentMethod: 'JAKLINGKO', departureAt: new Date('2026-07-20T08:00:00+07:00') } as const

  it('encodes payment method, service day and departure slot', () => {
    // 2026-07-20 is a Monday, so the service day is WD; 08:00 floors to 0800.
    expect(fareCacheKey('KCI-BKS', 'KCI-JAKK', peak, 'v3')).toBe('fares:KCI-BKS:KCI-JAKK:STORED_VALUE:WD:0800:v3')
  })

  it('produces distinct keys per payment method and per departure slot', () => {
    const base = fareCacheKey('KCI-BKS', 'KCI-JAKK', peak, 'v3')
    expect(fareCacheKey('KCI-BKS', 'KCI-JAKK', jaklingko, 'v3')).not.toBe(base) // method differs
    expect(fareCacheKey('KCI-BKS', 'KCI-JAKK', offpeak, 'v3')).not.toBe(base) // slot differs
  })

  /*
   * The reason the slot replaced the peak/off-peak bucket: two departures an
   * hour apart inside one peak window used to collapse onto a single entry, so
   * a rider asking for 08:40 could be served the body warmed for 07:10.
   */
  it('separates two departures inside the same fare bucket', () => {
    const at = (iso: string) =>
      fareCacheKey('KCI-BKS', 'KCI-JAKK', { paymentMethod: 'STORED_VALUE', departureAt: new Date(iso) }, 'v3')
    expect(at('2026-07-20T07:10:00+07:00')).not.toBe(at('2026-07-20T08:40:00+07:00'))
  })

  it('shares one key across a slot, so the cache still warms', () => {
    const at = (iso: string) =>
      fareCacheKey('KCI-BKS', 'KCI-JAKK', { paymentMethod: 'STORED_VALUE', departureAt: new Date(iso) }, 'v3')
    // 08:41 and 08:52 both floor to the 08:40 slot.
    expect(at('2026-07-20T08:41:00+07:00')).toBe(at('2026-07-20T08:52:00+07:00'))
    expect(at('2026-07-20T08:41:00+07:00')).toContain(':0840:')
  })

  /*
   * Routing now depends on the day, not just the fare: which lines run, and how
   * often. Without the day in the key a Saturday caller could be served a
   * Tuesday body and routed onto a corridor that does not run at the weekend.
   */
  it('separates the three service days from each other', () => {
    const on = (iso: string) =>
      fareCacheKey('KCI-BKS', 'KCI-JAKK', { paymentMethod: 'STORED_VALUE', departureAt: new Date(iso) }, 'v3')
    const weekday = on('2026-07-20T12:00:00+07:00') // Monday
    const saturday = on('2026-07-25T12:00:00+07:00')
    const sunday = on('2026-07-26T12:00:00+07:00')
    expect(new Set([weekday, saturday, sunday]).size).toBe(3)
    expect(saturday).toContain(':SAT:')
    expect(sunday).toContain(':SUN:')
  })

  it('keys a national holiday as a Sunday', () => {
    // 17 August 2026 is a Monday, but Hari Kemerdekaan runs Sunday service.
    const holiday = fareCacheKey(
      'KCI-BKS', 'KCI-JAKK',
      { paymentMethod: 'STORED_VALUE', departureAt: new Date('2026-08-17T12:00:00+07:00') },
      'v3'
    )
    expect(holiday).toContain(':SUN:')
  })
})
