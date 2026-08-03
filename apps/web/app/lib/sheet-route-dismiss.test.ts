import { describe, expect, it } from 'vitest'
import { resolveDismiss } from './sheet-route-dismiss'

describe('resolveDismiss', () => {
  // The bug, pinned. Headless UI fires onClose on focus loss and outside
  // interaction; a 0x0 iframe in a hidden Elementor tab panel triggers it
  // immediately. The old handler ran navigate('/'), so the TransportForJakarta
  // embed silently swapped the fare sheet for the homepage empty state.
  it('stays put when embedded, however much history there is', () => {
    expect(resolveDismiss({ historyLength: 1, embedded: true })).toBe('stay')
    expect(resolveDismiss({ historyLength: 12, embedded: true })).toBe('stay')
  })

  // A deep link, bookmark, or shared /fare?from=&to= URL. /fare is canonical,
  // not a modal over /, so a spurious close must not redirect home.
  it('stays put on a direct load with nothing behind it', () => {
    expect(resolveDismiss({ historyLength: 1, embedded: false })).toBe('stay')
  })

  // The normal in-app path: sheet-button.tsx pushState'd the URL in, so there
  // is a real entry to return to.
  it('goes back when opened as a sheet from within the app', () => {
    expect(resolveDismiss({ historyLength: 2, embedded: false })).toBe('back')
    expect(resolveDismiss({ historyLength: 9, embedded: false })).toBe('back')
  })

  // Defensive: a browser reporting 0 must not be read as "plenty of history".
  it('treats a zero history length as nothing behind', () => {
    expect(resolveDismiss({ historyLength: 0, embedded: false })).toBe('stay')
  })
})
