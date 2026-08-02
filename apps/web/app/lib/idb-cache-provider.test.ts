import { beforeEach, describe, expect, it, vi } from 'vitest'

// idb-keyval talks to real IndexedDB, which doesn't exist under the node-only
// vitest config. Mocking it is also what lets these tests drive the failure
// modes that matter here: storage that rejects rather than storage that is
// merely empty.
const mocks = vi.hoisted(() => ({
  getAllKeys: vi.fn(),
  get: vi.fn(),
  set: vi.fn(),
  del: vi.fn()
}))

vi.mock('idb-keyval', () => ({
  createStore: () => ({}),
  keys: mocks.getAllKeys,
  get: mocks.get,
  set: mocks.set,
  del: mocks.del
}))

const { idbCacheProvider } = await import('./idb-cache-provider')

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getAllKeys.mockResolvedValue([])
  mocks.get.mockResolvedValue(undefined)
})

describe('idbCacheProvider hydrate', () => {
  it('loads persisted entries into the in-memory map', async () => {
    mocks.getAllKeys.mockResolvedValue(['/stations/A'])
    mocks.get.mockResolvedValue({ name: 'A' })

    const provider = idbCacheProvider()
    await provider.hydrate()

    expect(provider.get('/stations/A')).toEqual({ name: 'A' })
  })

  // The reason this file exists. hydrate() is called without an await, so a
  // rejection escaping it becomes an unhandled rejection — which boot-watchdog
  // treats as positive evidence the app failed to boot, purging caches and
  // reloading a page that is actually fine. Blocked IndexedDB (private
  // browsing, denied storage, quota) must degrade to a cold start instead.
  it('resolves rather than rejecting when the key listing fails', async () => {
    mocks.getAllKeys.mockRejectedValue(new Error('storage disabled'))

    const provider = idbCacheProvider()

    await expect(provider.hydrate()).resolves.toBeUndefined()
  })

  it('keeps hydrating when a single entry is unreadable', async () => {
    mocks.getAllKeys.mockResolvedValue(['broken', '/stations/B'])
    mocks.get.mockImplementation(async (key: string) => {
      if (key === 'broken') throw new Error('unreadable')
      return { name: 'B' }
    })

    const provider = idbCacheProvider()
    await expect(provider.hydrate()).resolves.toBeUndefined()

    expect(provider.get('broken')).toBeUndefined()
    expect(provider.get('/stations/B')).toEqual({ name: 'B' })
  })

  // SWR may fill a key from the network while the async IDB read is in flight;
  // the persisted snapshot is older, so it must never clobber it.
  it('never overwrites an entry SWR already populated', async () => {
    mocks.getAllKeys.mockResolvedValue(['/stations/C'])
    mocks.get.mockResolvedValue({ name: 'stale' })

    const provider = idbCacheProvider()
    provider.set('/stations/C', { name: 'fresh' })
    await provider.hydrate()

    expect(provider.get('/stations/C')).toEqual({ name: 'fresh' })
  })
})
