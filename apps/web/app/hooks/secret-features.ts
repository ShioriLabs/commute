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

export function useMapUnlock() {
  const [isUnlocked, setIsUnlocked] = useState(false)

  // Read after mount rather than in the initial state: this tree renders on
  // the server too, where localStorage doesn't exist. Locked is the correct
  // first paint either way, so there's no flash of a revealed feature.
  useEffect(() => {
    setIsUnlocked(localStorage.getItem(MAP_UNLOCKED_KEY) === 'true')
  }, [])

  const setUnlocked = useCallback((next: boolean) => {
    localStorage.setItem(MAP_UNLOCKED_KEY, String(next))
    setIsUnlocked(next)
  }, [])

  return { isUnlocked, setUnlocked }
}
