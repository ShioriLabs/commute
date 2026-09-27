import { PAYMENT_METHODS } from '@commute/constants'
import { describe, expect, it } from 'vitest'
import { WALKING_PREFERENCES } from 'utils/fare-criteria'
import {
  MODES_DESCRIPTIONS,
  MODES_LABELS,
  OFFERED_PAYMENT_METHODS,
  PAYMENT_METHOD_DESCRIPTIONS,
  PAYMENT_METHOD_LABELS,
  PAYMENT_METHOD_SHORT_LABELS,
  WALKING_DESCRIPTIONS,
  WALKING_LABELS,
  WALKING_SHORT_LABELS
} from './labels'

describe('criteria labels', () => {
  // The Record<PaymentMethod, string> type already enforces this at build time;
  // this catches the case where the constants gain a method and someone
  // satisfies the compiler with an empty string.
  it('labels and describes every payment method the constants define', () => {
    for (const method of Object.keys(PAYMENT_METHODS)) {
      expect(PAYMENT_METHOD_LABELS[method as keyof typeof PAYMENT_METHODS]).toBeTruthy()
      expect(PAYMENT_METHOD_DESCRIPTIONS[method as keyof typeof PAYMENT_METHODS]).toBeTruthy()
      expect(PAYMENT_METHOD_SHORT_LABELS[method as keyof typeof PAYMENT_METHODS]).toBeTruthy()
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

  it('labels and describes both mode choices', () => {
    for (const mode of ['all', 'rail'] as const) {
      expect(MODES_LABELS[mode]).toBeTruthy()
      expect(MODES_DESCRIPTIONS[mode]).toBeTruthy()
    }
  })

  it('labels and describes every walking preference', () => {
    for (const preference of WALKING_PREFERENCES) {
      expect(WALKING_LABELS[preference]).toBeTruthy()
      expect(WALKING_DESCRIPTIONS[preference]).toBeTruthy()
      expect(WALKING_SHORT_LABELS[preference]).toBeTruthy()
    }
  })

  /*
   * The short forms exist to fit a chip segment beside two others. A long one
   * defeats the point — the row was rebuilt from four wrapping chips into one
   * segmented chip precisely to buy that width back, so this guards the
   * constraint rather than the wording.
   */
  it('keeps the chip-segment labels short', () => {
    for (const preference of WALKING_PREFERENCES) {
      expect(WALKING_SHORT_LABELS[preference].length).toBeLessThanOrEqual(8)
    }
    for (const method of OFFERED_PAYMENT_METHODS) {
      expect(PAYMENT_METHOD_SHORT_LABELS[method].length).toBeLessThanOrEqual(10)
    }
  })

  /*
   * Never a duration, in any walking copy.
   *
   * The engine has no duration model (edges.durationSeconds is null on every
   * row), so "5 menit lebih lama" would be a promise it cannot keep. These
   * describe how the RANKING shifts instead. Catches a well-meaning rewrite
   * that reaches for minutes to sound concrete.
   */
  it('never promises a duration in walking copy', () => {
    for (const preference of WALKING_PREFERENCES) {
      expect(WALKING_DESCRIPTIONS[preference]).not.toMatch(/menit|jam\b|mnt/i)
      expect(WALKING_LABELS[preference]).not.toMatch(/menit|jam\b|mnt/i)
    }
  })
})
