import { useEffect, useState } from 'react'

const QUERY = '(prefers-reduced-motion: reduce)'

function matches(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia(QUERY).matches
}

// Whether the user has asked for reduced motion.
//
// app.css already neutralises every CSS *animation* entrance in the app, but a
// CSS *transition* can't be switched off from a stylesheet without also
// stranding the element in its start state — so anything transition-driven has
// to branch on this in JS and pick a different closed state instead. The sheet
// morph is the app's largest movement and the only such case today.
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(matches)

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return

    const query = window.matchMedia(QUERY)
    const handleChange = (event: MediaQueryListEvent) => setReduced(event.matches)

    // Re-read on mount as well: the initial state was computed during render,
    // which on a prerendered route happens before the preference is knowable.
    setReduced(query.matches)
    query.addEventListener('change', handleChange)
    return () => query.removeEventListener('change', handleChange)
  }, [])

  return reduced
}
