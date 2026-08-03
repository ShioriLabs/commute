import { useEffect, useState } from 'react'

// Tailwind's `lg` breakpoint. Below it the map's detail surface is a bottom
// sheet; at or above it the same content becomes a floating left card.
const QUERY = '(min-width: 1024px)'

function matches(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia(QUERY).matches
}

// Whether the viewport is desktop-width.
//
// Read in JS rather than expressed as a Tailwind variant because the two
// surfaces are different components, not two skins of one: the sheet owns a
// pointer-driven snap/drag engine that has no desktop counterpart. Rendering
// both and hiding one with `lg:` classes would keep that engine live.
export function useIsDesktop(): boolean {
  const [desktop, setDesktop] = useState(matches)

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return

    const query = window.matchMedia(QUERY)
    const handleChange = (event: MediaQueryListEvent) => setDesktop(event.matches)

    // Re-read on mount: the initial state was computed during render, which on
    // a prerendered route happens before the viewport is knowable. A false→true
    // flip is harmless here because detail surfaces only open post-mount.
    setDesktop(query.matches)
    query.addEventListener('change', handleChange)
    return () => query.removeEventListener('change', handleChange)
  }, [])

  return desktop
}
