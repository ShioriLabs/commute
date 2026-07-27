// Which half of the search sheet the user was last in. Persisted so a commuter
// who mostly checks fares doesn't re-select the mode on every open.
//
// Deliberately not in the URL: SheetButton captures its `url` once when the
// sheet opens and never revisits it, so a mode-in-URL scheme would have to write
// history behind its back — risking the `modalOpen` flag its close handler
// depends on. Storage costs nothing and matches the flags in
// app/hooks/secret-features.ts.
export type SearchMode = 'STATION' | 'FARE'

export const SEARCH_MODE_KEY = 'search-mode'
export const DEFAULT_SEARCH_MODE: SearchMode = 'STATION'

export function readSearchMode(): SearchMode {
  try {
    return localStorage.getItem(SEARCH_MODE_KEY) === 'FARE' ? 'FARE' : DEFAULT_SEARCH_MODE
  } catch {
    // Storage throws in a partitioned or locked-down context. Not a reason to
    // take the page down with it — fall back to the default mode.
    return DEFAULT_SEARCH_MODE
  }
}

export function writeSearchMode(mode: SearchMode) {
  try {
    localStorage.setItem(SEARCH_MODE_KEY, mode)
  } catch {
    // See readSearchMode.
  }
}
