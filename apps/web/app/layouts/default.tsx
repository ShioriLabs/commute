import { useRef } from 'react'
import { Outlet } from 'react-router'
import { SWRConfig } from 'swr'
import { MapMorphProvider } from '~/components/map-morph'
import { idbCacheProvider } from '~/lib/idb-cache-provider'

export default function DefaultLayout() {
  // Create the provider once and hydrate once. Building a new Map (and firing
  // a fresh async hydrate) on every render previously raced the in-flight SWR
  // fetches and left the cache in an inconsistent state.
  const cacheRef = useRef<ReturnType<typeof idbCacheProvider> | null>(null)
  if (!cacheRef.current) {
    cacheRef.current = idbCacheProvider()
    // Deliberately not awaited — SWR renders from the in-memory map and the
    // persisted entries fill in behind it. The catch is what keeps that
    // fire-and-forget safe: an escaping rejection would trip the boot watchdog
    // into a needless recovery reload. See idb-cache-provider.ts.
    cacheRef.current.hydrate().catch(() => {})
  }
  const cache = cacheRef.current

  return (
    <SWRConfig value={{ provider: () => cache }}>
      {/*
        The map morph overlay lives here, not in the map button or root.tsx:
        both `/` and `/map` render under this layout, so the overlay survives
        the navigation it plays over (the button unmounts with the home route
        mid-morph), and a root ErrorBoundary replacing the layout tears a
        stuck overlay down with it.
      */}
      <MapMorphProvider>
        <Outlet />
      </MapMorphProvider>
    </SWRConfig>
  )
}
