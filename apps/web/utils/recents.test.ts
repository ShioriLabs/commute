import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readRecentRoutes, readRecents, recordRecent, recordRecentRoute } from './recents'

let store: Map<string, string>

beforeEach(() => {
  store = new Map()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v) }
  } as Partial<Storage> as Storage)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('recent routes', () => {
  it('records newest first, de-duplicated, and directional', () => {
    recordRecentRoute({ from: 'A', to: 'B' })
    recordRecentRoute({ from: 'B', to: 'A' })
    recordRecentRoute({ from: 'A', to: 'B' })
    expect(readRecentRoutes()).toEqual([{ from: 'A', to: 'B' }, { from: 'B', to: 'A' }])
  })

  it('caps the list without touching station recents', () => {
    recordRecent({ type: 'STATION', id: 'KCI-MRI' })
    for (let i = 0; i < 10; i++) recordRecentRoute({ from: `S${i}`, to: 'X' })
    expect(readRecentRoutes()).toHaveLength(5)
    expect(readRecentRoutes()[0]).toEqual({ from: 'S9', to: 'X' })
    expect(readRecents()).toEqual([{ type: 'STATION', id: 'KCI-MRI' }])
  })

  it('reads corrupt values as empty and drops malformed entries', () => {
    store.set('recent-routes', '{bad')
    expect(readRecentRoutes()).toEqual([])
    store.set('recent-routes', '[{"from":"A"},{"from":"A","to":"B"},3]')
    expect(readRecentRoutes()).toEqual([{ from: 'A', to: 'B' }])
  })
})
