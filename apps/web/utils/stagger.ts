// Per-item entrance delays for staggered lists.
//
// Items using this carry a CSS class whose keyframes start at `opacity: 0`
// (see `.search-result-enter` / `.home-enter` in app/app.css), so an item sits
// invisible until its delay elapses. That is what makes the cap load-bearing
// rather than cosmetic: without one, the fiftieth row of a long list would wait
// a second and a half before appearing at all.

export interface StaggerOptions {
  // Milliseconds between consecutive items.
  step: number
  // Index past which every item shares the same delay.
  maxIndex: number
  // Milliseconds before the first item starts. Lets one group follow another —
  // the nav rail waits for the station feed rather than racing it.
  offset?: number
}

// Dense rows — search results, the fare picker. Short travel, tight spacing.
export const LIST_STAGGER_MAX_INDEX = 12
export const LIST_STAGGER_STEP_MS = 30

// Tall cards — the homepage station feed. Fewer of them, and each is large
// enough that a 30ms gap reads as "all at once" rather than as a sequence.
export const CARD_STAGGER_MAX_INDEX = 6
export const CARD_STAGGER_STEP_MS = 45

// Frozen presets rather than object literals at the call sites: these are read
// inside memoized list rows, and a fresh object per render is needless garbage
// on the exact path the picker's memo() exists to keep cheap.
export const LIST_STAGGER: StaggerOptions = {
  step: LIST_STAGGER_STEP_MS,
  maxIndex: LIST_STAGGER_MAX_INDEX
}

export const CARD_STAGGER: StaggerOptions = {
  step: CARD_STAGGER_STEP_MS,
  maxIndex: CARD_STAGGER_MAX_INDEX
}

// Nav rail cards. Offset so the rail arrives after the station feed has started
// rather than alongside it — the rail is chrome, and leading with it would read
// as the page assembling backwards. At most three items, so no meaningful cap.
//
// The offset is deliberately shorter than a card's 300ms animation: the rail
// begins while the first card is still settling, so the two groups overlap into
// one gesture instead of reading as two separate waves.
export const NAV_STAGGER_OFFSET_MS = 120
export const NAV_STAGGER_STEP_MS = 50

// Per-letter delay for the wordmark reveal in root.tsx's HydrateFallback.
// Faster than the card cascade: seven letters at the card's 45ms would take
// 315ms to spell a seven-character word, which reads as slow typing rather than
// as one mark assembling.
export const WORDMARK_LETTER_STAGGER_MS = 35

export const NAV_STAGGER: StaggerOptions = {
  step: NAV_STAGGER_STEP_MS,
  maxIndex: 4,
  offset: NAV_STAGGER_OFFSET_MS
}

// Delay for the item at `index`, as a CSS time string ready for
// `style={{ animationDelay: … }}`.
//
// Callers own their own gating — whether an item animates at all is a separate
// decision from how long it waits. The two existing call sites deliberately
// differ there: search results past the cap still animate (sharing the maximum
// delay) while fare-picker rows past it skip the animation entirely, because
// that list runs to hundreds of rows.
export function staggerDelay(index: number, { step, maxIndex, offset = 0 }: StaggerOptions): string {
  const clamped = Math.min(Math.max(index, 0), maxIndex)
  return `${offset + clamped * step}ms`
}
