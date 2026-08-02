import { PAYMENT_METHODS } from '@commute/constants'
import { describe, expect, it } from 'vitest'
import {
  FARE_TIME_DESCRIPTIONS,
  FARE_TIME_LABELS,
  OFFERED_PAYMENT_METHODS,
  operatorLabel,
  operatorsPresent,
  PAYMENT_METHOD_DESCRIPTIONS,
  PAYMENT_METHOD_LABELS
} from './labels'

describe('criteria labels', () => {
  // The Record<PaymentMethod, string> type already enforces this at build time;
  // this catches the case where the constants gain a method and someone
  // satisfies the compiler with an empty string.
  it('labels and describes every payment method the constants define', () => {
    for (const method of Object.keys(PAYMENT_METHODS)) {
      expect(PAYMENT_METHOD_LABELS[method as keyof typeof PAYMENT_METHODS]).toBeTruthy()
      expect(PAYMENT_METHOD_DESCRIPTIONS[method as keyof typeof PAYMENT_METHODS]).toBeTruthy()
    }
  })

  /*
   * JakLingko must stay out of the offered list until fare-summary.ts's cap is
   * reworked to min(2500 + 250/km, 10000). Offering it would make a
   * known-incorrect fare selectable and shareable. If someone adds it back,
   * this should fail and send them to read that comment first.
   */
  it('does not offer JakLingko while its cap is known-incorrect', () => {
    expect(OFFERED_PAYMENT_METHODS).not.toContain('JAKLINGKO')
    expect(OFFERED_PAYMENT_METHODS).toEqual(['STORED_VALUE', 'QRIS_TAP'])
  })

  it('only offers methods it can label', () => {
    for (const method of OFFERED_PAYMENT_METHODS) {
      expect(PAYMENT_METHOD_LABELS[method]).toBeTruthy()
    }
  })

  it('labels and describes every fare time bucket', () => {
    for (const bucket of ['now', 'peak', 'offpeak'] as const) {
      expect(FARE_TIME_LABELS[bucket]).toBeTruthy()
      expect(FARE_TIME_DESCRIPTIONS[bucket]).toBeTruthy()
    }
  })

  it('calls a missing operator filter "Semua"', () => {
    expect(operatorLabel(null)).toBe('Semua')
  })

  it('resolves a known operator to its display name', () => {
    expect(operatorLabel('KCI')).toBe('Commuter Line')
  })
})

describe('operatorsPresent', () => {
  it('lists only operators the stations actually contain', () => {
    const stations = [{ operator: 'TJ' as const }, { operator: 'KCI' as const }, { operator: 'TJ' as const }]
    expect(operatorsPresent(stations)).toEqual(['KCI', 'TJ'])
  })

  // Canonical order, not first-seen order, so the sheet does not reshuffle as
  // the operator filter narrows the list it was derived from.
  it('uses canonical operator order regardless of input order', () => {
    const forwards = operatorsPresent([{ operator: 'KCI' as const }, { operator: 'MRTJ' as const }])
    const backwards = operatorsPresent([{ operator: 'MRTJ' as const }, { operator: 'KCI' as const }])
    expect(forwards).toEqual(backwards)
  })

  it('returns nothing for an empty list', () => {
    expect(operatorsPresent([])).toEqual([])
  })
})
