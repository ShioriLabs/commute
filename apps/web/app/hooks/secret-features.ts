import { useCallback, useEffect, useState } from 'react'

// The map's GPU/context-loss instrumentation — the on-screen tile/memory panel
// and `window.__mapDebug`. It hides behind an obscure gesture in Settings →
// Tentang rather than a URL because an installed PWA runs without an address
// bar, so there's no way to type an unlisted route. On iOS a standalone PWA
// also gets its own storage jar, so setting the flag in Safari would not carry
// into the installed app, which is exactly where the instrumentation is needed.
//
// The same gesture now reveals the experimental line-isolation toggle. One
// hidden door rather than two: a second gesture for every unfinished feature
// gets forgotten, and this one is already documented where it is performed.
const MAP_GL_DEBUG_KEY = 'map-gl-debug'

function readFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) === 'true'
  } catch {
    // Storage throws in a partitioned or locked-down context. Not a reason to
    // take the page down with it — treat it as "off".
    return false
  }
}

function writeFlag(key: string, value: boolean) {
  try {
    localStorage.setItem(key, String(value))
  } catch {
    // See readFlag.
  }
}

// Whether the map should expose its renderer instrumentation. Always on in dev.
export function isMapGlDebugEnabled(): boolean {
  return import.meta.env.DEV || readFlag(MAP_GL_DEBUG_KEY)
}

export function useMapGlDebug() {
  const [isEnabled, setIsEnabled] = useState(false)

  // Read after mount rather than in the initial state: this tree renders on
  // the server too, where localStorage doesn't exist. Off is the correct first
  // paint either way, so there's no flash of a revealed panel.
  useEffect(() => {
    setIsEnabled(readFlag(MAP_GL_DEBUG_KEY))
  }, [])

  const setEnabled = useCallback((next: boolean) => {
    writeFlag(MAP_GL_DEBUG_KEY, next)
    setIsEnabled(next)
  }, [])

  return { isEnabled, setEnabled }
}

/*
 * Whether experimental settings should be listed at all.
 *
 * Shares the debug flag rather than owning one, so the 7-tap gesture in
 * Settings → Tentang reveals everything unfinished at once. Note this only
 * REVEALS the toggle; whether line isolation is actually on is its own stored
 * choice (utils/line-isolate.ts), so turning the debug flag back off hides the
 * control without silently changing what the map does.
 */
export function useExperimentalSettings() {
  const { isEnabled } = useMapGlDebug()
  return isEnabled
}
