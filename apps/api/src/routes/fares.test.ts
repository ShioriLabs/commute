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

  it('encodes payment method and time bucket', () => {
    expect(fareCacheKey('KCI-BKS', 'KCI-JAKK', peak, 'v3')).toBe('fares:KCI-BKS:KCI-JAKK:STORED_VALUE:peak:v3')
  })

  it('produces distinct keys per payment method and per time bucket', () => {
    const base = fareCacheKey('KCI-BKS', 'KCI-JAKK', peak, 'v3')
    expect(fareCacheKey('KCI-BKS', 'KCI-JAKK', jaklingko, 'v3')).not.toBe(base) // method differs
    expect(fareCacheKey('KCI-BKS', 'KCI-JAKK', offpeak, 'v3')).not.toBe(base) // bucket differs
  })
})
