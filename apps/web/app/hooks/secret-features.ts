import { useCallback, useEffect, useState } from 'react'

// Gate for features that are built but not launched yet.
//
// The flag lives in localStorage and is set by an obscure gesture in
// Settings → Tentang rather than by a URL, because an installed PWA runs
// without an address bar — there's no way to type an unlisted route. On iOS a
// standalone PWA also gets its own storage jar, so unlocking in Safari would
// not carry into the installed app, which is exactly where it's needed.
//
// This hides the entry point only. `/map` itself still renders for anyone who
// navigates to it directly, same as before.
const MAP_UNLOCKED_KEY = 'is-map-unlocked'

// The map's GPU/context-loss instrumentation rides along with the unlock, for
// the same reason the unlock is a gesture in the first place: the installed PWA
// has no address bar and no console, so the alternative was tethering the phone
// to a laptop to set a flag by hand. Anyone who has done the 7-tap is in debug
// mode; hiding the map again turns it back off.
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

// Whether the map should expose its renderer instrumentation — the on-screen
// tile/memory panel and `window.__mapDebug`. Always on in dev.
export function isMapGlDebugEnabled(): boolean {
  return import.meta.env.DEV || readFlag(MAP_GL_DEBUG_KEY)
}

export function useMapUnlock() {
  const [isUnlocked, setIsUnlocked] = useState(false)

  // Read after mount rather than in the initial state: this tree renders on
  // the server too, where localStorage doesn't exist. Locked is the correct
  // first paint either way, so there's no flash of a revealed feature.
  useEffect(() => {
    setIsUnlocked(readFlag(MAP_UNLOCKED_KEY))
  }, [])

  const setUnlocked = useCallback((next: boolean) => {
    writeFlag(MAP_UNLOCKED_KEY, next)
    writeFlag(MAP_GL_DEBUG_KEY, next)
    setIsUnlocked(next)
  }, [])

  return { isUnlocked, setUnlocked }
}
