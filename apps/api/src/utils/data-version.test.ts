import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DATA_VERSION_KV_KEY } from '@commute/constants'
import { cacheVersion, dataVersion, resetDataVersionMemo } from 'utils/data-version'

const kvReturning = (value: unknown) => ({ get: vi.fn(async () => value) }) as unknown as KVNamespace & { get: ReturnType<typeof vi.fn> }

describe('dataVersion', () => {
  beforeEach(() => resetDataVersionMemo())

  it('defaults to \'0\' when nothing has been published', async () => {
    expect(await dataVersion(kvReturning(null), 0)).toBe('0')
  })

  it('defaults to \'0\' without a KV binding', async () => {
    expect(await dataVersion(undefined, 0)).toBe('0')
  })

  it('treats a non-string value as \'0\' (test mocks return objects for any key)', async () => {
    expect(await dataVersion(kvReturning({ stations: [] }), 0)).toBe('0')
  })

  it('reads the key once per 60 s per isolate', async () => {
    const kv = kvReturning('20261001T161500-ab12')
    expect(await dataVersion(kv, 0)).toBe('20261001T161500-ab12')
    expect(await dataVersion(kv, 59_999)).toBe('20261001T161500-ab12')
    expect(kv.get).toHaveBeenCalledTimes(1)
    expect(kv.get).toHaveBeenCalledWith(DATA_VERSION_KV_KEY)
    await dataVersion(kv, 60_000)
    expect(kv.get).toHaveBeenCalledTimes(2)
  })

  it('keeps the last known version when KV throws, and retries on the next call', async () => {
    const kv = kvReturning('v-good')
    await dataVersion(kv, 0)
    kv.get.mockRejectedValueOnce(new Error('KV down'))
    expect(await dataVersion(kv, 61_000)).toBe('v-good')
    expect(await dataVersion(kv, 61_001)).toBe('v-good')
    expect(kv.get).toHaveBeenCalledTimes(3)
  })
})

describe('cacheVersion', () => {
  beforeEach(() => resetDataVersionMemo())

  it('joins API_VERSION and the data version', async () => {
    expect(await cacheVersion({ API_VERSION: '20261001a', KV: kvReturning('p1') })).toBe('20261001a.p1')
    resetDataVersionMemo()
    expect(await cacheVersion({ API_VERSION: '20261001a' })).toBe('20261001a.0')
  })
})
