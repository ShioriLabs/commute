import { createStore, set, keys as getAllKeys, del, get } from 'idb-keyval'
import { useRef } from 'react'
import { Outlet } from 'react-router'
import { SWRConfig } from 'swr'
import { MapMorphProvider } from '~/components/map-morph'

const store = createStore('swr-db', 'cache-store')

export const idbCacheProvider = () => {
  const map = new Map()

  return {
    get(key: string) {
      return map.get(key)
    },
    set(key: string, value: unknown) {
      map.set(key, value)
      set(key, value, store)
    },
    delete(key: string) {
      map.delete(key)
      del(key, store)
    },
    keys() {
      return map.keys()
    },
    async hydrate() {
      const keys = await getAllKeys(store)
      for (const key of keys) {
        // Never overwrite an entry SWR has already populated this session. The
        // IDB read is async, so by the time it resolves a fetch may have filled
        // this key with fresh data — clobbering it with the stale snapshot
        // would strand the UI on a no-data state. Re-check after the await
        // since SWR may have written the key while we were reading.
        if (map.has(key)) continue
        const value = await get(key, store)
        if (value !== undefined && !map.has(key)) {
          map.set(key, value)
        }
      }
    }
  }
}

export default function DefaultLayout() {
  // Create the provider once and hydrate once. Building a new Map (and firing
  // a fresh async hydrate) on every render previously raced the in-flight SWR
  // fetches and left the cache in an inconsistent state.
  const cacheRef = useRef<ReturnType<typeof idbCacheProvider> | null>(null)
  if (!cacheRef.current) {
    cacheRef.current = idbCacheProvider()
    cacheRef.current.hydrate()
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
