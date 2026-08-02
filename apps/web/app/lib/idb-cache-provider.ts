// SWR's cache provider, backed by IndexedDB.
//
// Extracted from app/layouts/default.tsx so it can be tested without pulling
// React components (and the `~` alias) into the node-only vitest config. It is
// pure logic with no React dependency, and its failure modes are worth pinning:
// see app/layouts/idb-cache-provider.test.ts.
import { createStore, set, keys as getAllKeys, del, get } from 'idb-keyval'

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
      // IndexedDB is not always reachable — private browsing, blocked storage
      // and quota errors all reject here. A rejection must not escape: this is
      // called without an await, so an unhandled rejection is what the boot
      // watchdog reads as positive evidence that the app failed to load, and it
      // would purge the caches and reload a page that is in fact working.
      // Losing the persisted cache is a cold start, not a failure.
      let keys: IDBValidKey[] = []
      try {
        keys = await getAllKeys(store)
      } catch {
        return
      }
      for (const key of keys) {
        // Never overwrite an entry SWR has already populated this session. The
        // IDB read is async, so by the time it resolves a fetch may have filled
        // this key with fresh data — clobbering it with the stale snapshot
        // would strand the UI on a no-data state. Re-check after the await
        // since SWR may have written the key while we were reading.
        if (map.has(key)) continue
        let value: unknown
        try {
          value = await get(key, store)
        } catch {
          // One unreadable entry shouldn't abandon the rest of the cache.
          continue
        }
        if (value !== undefined && !map.has(key)) {
          map.set(key, value)
        }
      }
    }
  }
}
