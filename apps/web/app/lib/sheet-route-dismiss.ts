// Where a standalone sheet route (`/fare`, `/settings`) should go when it closes.
//
// These routes are reachable two ways, and the right dismissal differs:
//
//   1. Opened as a sheet from the home rail. sheet-button.tsx swaps the URL in
//      with pushState while the sheet animates open, so there IS history to go
//      back to and going home is correct.
//   2. Loaded directly — a deep link, a bookmark, a shared `/fare?from=&to=`,
//      or an <iframe src>. There is no history entry behind it. `/fare` is a
//      canonical URL, not a modal over `/`, so redirecting home throws away the
//      page the user actually asked for.
//
// Case 2 is what broke the TransportForJakarta embed: Headless UI's Dialog
// fires onClose on focus loss and outside interaction, which a zero-size or
// backgrounded iframe triggers spuriously. The handler ran `navigate('/')`, so
// the frame silently replaced the fare sheet with the homepage empty state.
// The same spurious close hits any ordinary deep link, it is just less visible
// there.

export interface DismissContext {
  /** Entries in the session history stack (`window.history.length`). */
  historyLength: number
  /** True when the document is not the top-level browsing context. */
  embedded: boolean
}

/**
 * `'back'` returns to whatever opened the sheet; `'stay'` leaves the route
 * alone. Never navigates to `/` explicitly — going back lands there naturally
 * when that is where the user came from, and does not invent a destination when
 * it is not.
 */
export type DismissAction = 'back' | 'stay'

// A fresh tab that loaded straight into the route: history.length is 1, so
// there is nothing behind it. Browsers also cap and reuse the stack, so this is
// a floor check rather than an exact count.
const NO_HISTORY_BEHIND = 1

export function resolveDismiss(context: DismissContext): DismissAction {
  // Embedded: never navigate. The host page decides what its frame shows, and a
  // spurious close must not silently swap the embed for a different page.
  if (context.embedded) return 'stay'
  if (context.historyLength <= NO_HISTORY_BEHIND) return 'stay'
  return 'back'
}

/** Reads the real browser context. Split out so `resolveDismiss` stays pure. */
export function readDismissContext(): DismissContext {
  return {
    historyLength: window.history.length,
    // `window.top` throws on cross-origin access in some browsers, so compare
    // against `window.self` defensively: any failure means treat it as embedded,
    // which is the conservative answer (stay put rather than navigate).
    embedded: (() => {
      try {
        return window.self !== window.top
      } catch {
        return true
      }
    })()
  }
}
