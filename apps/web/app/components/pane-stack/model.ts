// The pane stack: what can be pushed on top of the map's detail card, where a
// card sits once something is pushed over it, and when a push is allowed.
//
// Pure and dependency-free so it can be unit tested — vitest's include list is
// `app/**/*.test.ts` with no `.tsx` glob, so anything that needs coverage has to
// live in a `.ts` module rather than beside the components that consume it.

/** What a pushed card shows. The base card is not one of these — it stays owned
 * by the map's own `selectedStation` / `selectedHubSlug` state. */
export type PaneDescriptor =
  | { kind: 'station', operator: string, code: string }
  | { kind: 'timetable', operator: string, code: string }

/**
 * The canonical route a descriptor stands for. Single source of truth: call
 * sites pass only the descriptor, so the URL pushed into history and the content
 * rendered in the card cannot drift apart. It is also what makes a stacked view
 * shareable — every one of these is a real route that renders standalone.
 */
export function paneUrl(pane: PaneDescriptor): string {
  switch (pane.kind) {
    case 'station':
      return `/stations/${pane.operator}/${pane.code}`
    case 'timetable':
      return `/stations/${pane.operator}/${pane.code}/timetable`
  }
}

/** Identity for dedupe and React keys. */
export function paneKey(pane: PaneDescriptor): string {
  return `${pane.kind}:${pane.operator}/${pane.code}`
}

// One pushed card, so two counting the base.
//
// This is a react-router constraint, not a visual one. Pushed cards get their
// URL through `history.pushState`, which react-router never sees — but it does
// listen for `popstate`, and its handler navigates to whatever URL the pop lands
// on. At depth 1 every owned entry sits directly on `/map`, so a Back lands on
// the route that is already rendered and nothing unmounts. At depth 2 a Back
// from `/stations/:op/:code/timetable` would land on `/stations/:op/:code` — a
// different route — and react-router would tear the map down to render it, which
// is the exact thing the deck exists to avoid. React Router has no intercepting
// -route primitive to opt out of that.
//
// The chains this leaves are station → timetable and hub → station, which are
// the ones that matter. A third level is refused and falls back to a normal
// navigation, i.e. exactly what happens today.
export const MAX_PANE_STACK_DEPTH = 1

// Where a card sits once `above` cards are stacked on top of it. Index is
// `above`; the last entry is the clamp.
//
// The top card never moves. Cards underneath slide left and scale down, so the
// depth cue is a sliver of the covered card poking out past the left edge of the
// one covering it. The card is `left-4 w-[25rem]` — a 16px inset — so an offset
// has to keep `16 + x` above zero or the card clips off screen:
//
//   above  x     left edge  sliver
//   0       0px  16px       — (top card)
//   1      -8px   8px       8px
//
// Entries past MAX_PANE_STACK_DEPTH are unreachable today; the clamp in
// deckGeometry is what keeps a deeper deck degrading gracefully rather than
// sliding off screen, should the cap ever be raised.
const DECK_SLOTS = [
  { x: 0, scale: 1 },
  { x: -8, scale: 0.965 }
] as const

export interface DeckGeometry {
  /** Horizontal offset in px, negative = further left than the top card. */
  x: number
  scale: number
}

export function deckGeometry(above: number): DeckGeometry {
  const slot = DECK_SLOTS[Math.min(Math.max(above, 0), DECK_SLOTS.length - 1)]
  return { x: slot.x, scale: slot.scale }
}

/** Minimum an entry has to expose for {@link canPush} to judge it. */
export interface StackedPane {
  key: string
  /** Exit animation in flight. Such an entry still occupies the DOM but is on
   * its way out, so it must not be counted as a push target. */
  exiting: boolean
}

/**
 * Whether `pane` may be pushed onto `entries`.
 *
 * Rejecting is not a dead end: the caller falls back to navigating to
 * {@link paneUrl}, so a refused push still takes the user where they asked to go
 * — just as a full page rather than a card.
 */
export function canPush(entries: readonly StackedPane[], pane: PaneDescriptor): boolean {
  // Mid-exit the deck depth is ambiguous and the history entries are still being
  // unwound. Let it settle rather than racing it.
  if (entries.some(entry => entry.exiting)) return false
  if (entries.length >= MAX_PANE_STACK_DEPTH) return false
  // Already the top card. A double-click gets here with the first push already
  // committed, and stacking a card on an identical one would strand a history
  // entry that looks like a no-op to the user.
  const top = entries[entries.length - 1]
  return top?.key !== paneKey(pane)
}
