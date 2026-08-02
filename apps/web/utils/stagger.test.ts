import { describe, expect, it } from 'vitest'
import {
  CARD_STAGGER_MAX_INDEX,
  CARD_STAGGER_STEP_MS,
  LIST_STAGGER_MAX_INDEX,
  LIST_STAGGER_STEP_MS,
  NAV_STAGGER,
  NAV_STAGGER_OFFSET_MS,
  staggerDelay
} from './stagger'

// Items animating with these delays start at `opacity: 0`, so a delay that
// grows without bound leaves later items invisible for as long as it lasts.
// The cap is the safety property worth testing.

const LIST = { step: LIST_STAGGER_STEP_MS, maxIndex: LIST_STAGGER_MAX_INDEX }
const CARDS = { step: CARD_STAGGER_STEP_MS, maxIndex: CARD_STAGGER_MAX_INDEX }

describe('staggerDelay', () => {
  it('starts the first item immediately', () => {
    expect(staggerDelay(0, LIST)).toBe('0ms')
    expect(staggerDelay(0, CARDS)).toBe('0ms')
  })

  it('spaces items by the step', () => {
    // Derived from the constants rather than hard-coded: these are tuning knobs
    // and the property under test is the arithmetic, not the current taste.
    expect(staggerDelay(1, LIST)).toBe(`${LIST_STAGGER_STEP_MS}ms`)
    expect(staggerDelay(3, LIST)).toBe(`${3 * LIST_STAGGER_STEP_MS}ms`)
    expect(staggerDelay(1, CARDS)).toBe(`${CARD_STAGGER_STEP_MS}ms`)
    expect(staggerDelay(3, CARDS)).toBe(`${3 * CARD_STAGGER_STEP_MS}ms`)
  })

  it('caps the delay so a long list never tails off', () => {
    const atCap = staggerDelay(LIST_STAGGER_MAX_INDEX, LIST)
    expect(atCap).toBe(`${LIST_STAGGER_MAX_INDEX * LIST_STAGGER_STEP_MS}ms`)
    // Everything past the cap shares that delay rather than growing.
    expect(staggerDelay(LIST_STAGGER_MAX_INDEX + 1, LIST)).toBe(atCap)
    expect(staggerDelay(500, LIST)).toBe(atCap)
  })

  it('keeps the card cascade under a third of a second', () => {
    // The whole point of the lower card cap: the last card must not feel like
    // a straggler behind the rest of the page. Asserts the budget, not the
    // exact value, so the step stays tunable.
    const last = staggerDelay(CARD_STAGGER_MAX_INDEX, CARDS)
    expect(Number.parseInt(last, 10)).toBeLessThanOrEqual(300)
  })

  it('treats a negative index as the first item', () => {
    // Guards against a caller passing an unfound array index (-1), which would
    // otherwise produce a negative delay and start the animation mid-flight.
    expect(staggerDelay(-1, LIST)).toBe('0ms')
    expect(staggerDelay(-99, CARDS)).toBe('0ms')
  })

  it('shifts the whole group by the offset', () => {
    // The nav rail follows the station feed rather than racing it.
    const rail = { step: 70, maxIndex: 4, offset: 180 }
    expect(staggerDelay(0, rail)).toBe('180ms')
    expect(staggerDelay(1, rail)).toBe('250ms')
    expect(staggerDelay(2, rail)).toBe('320ms')
    // The cap applies to the step, not the offset.
    expect(staggerDelay(99, rail)).toBe('460ms')
  })

  it('starts the nav rail while the first card is still settling', () => {
    // The rail is meant to overlap the card cascade, not queue behind it —
    // otherwise the page reads as two separate waves. 300ms is the card
    // animation's duration (.home-enter in app/app.css).
    expect(NAV_STAGGER_OFFSET_MS).toBeLessThan(300)
    expect(staggerDelay(0, NAV_STAGGER)).toBe(`${NAV_STAGGER_OFFSET_MS}ms`)
  })

  it('defaults the offset to zero', () => {
    expect(staggerDelay(0, { step: 30, maxIndex: 12 })).toBe('0ms')
  })

  it('returns a CSS time string, not a bare number', () => {
    // A unitless value is invalid for animation-delay and silently does nothing.
    for (const index of [0, 1, 7, 40]) {
      expect(staggerDelay(index, LIST)).toMatch(/^\d+ms$/)
    }
  })
})
