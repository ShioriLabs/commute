import { createStore, set, keys as getAllKeys, del, get } from 'idb-keyval'
import { Outlet } from 'react-router'
import { SWRConfig } from 'swr'

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
        const value = await get(key, store)
        if (value !== undefined) {
          map.set(key, value)
        }
      }
    }
  }
}

export default function DefaultLayout() {
  const cache = idbCacheProvider()
  cache.hydrate()

  return (
    <SWRConfig value={{ provider: () => cache }}>
      <Outlet />
    </SWRConfig>
  )
}
