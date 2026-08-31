import { PAYMENT_METHODS } from '@commute/constants'
import { describe, expect, it } from 'vitest'
import {
  FARE_TIME_DESCRIPTIONS,
  FARE_TIME_LABELS,
  OFFERED_PAYMENT_METHODS,
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
})
