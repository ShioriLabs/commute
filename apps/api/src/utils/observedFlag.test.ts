import { afterEach, describe, expect, it } from 'vitest'
import {
  OBSERVED_RUNTIMES_FLAG_KEY,
  observedRuntimesModeFor,
  refreshObservedRuntimesFlag,
  setObservedRuntimesMode
} from './observedFlag'

/*
 * The observed-runtimes mode switch. The headway kill switch beside it is tested
 * in observedHeadways.test.ts; this one has three values instead of two, and the
 * part worth pinning is what an unknown value means.
 */
describe('observed-runtimes mode', () => {
  const keys: string[] = []
  const kv = (value: string | null | Error) => ({
    get: async (key: string) => {
      keys.push(key)
      if (value instanceof Error) throw value
      return value
    }
  }) as unknown as KVNamespace
  const request = () => new Request('https://x.test/')

  afterEach(() => setObservedRuntimesMode('sort'))

  it('reads its own key, and defaults to sort when the key is absent', async () => {
    const r = request()
    await refreshObservedRuntimesFlag(kv(null), r)
    expect(keys.at(-1)).toBe(OBSERVED_RUNTIMES_FLAG_KEY)
    expect(observedRuntimesModeFor(r)).toBe('sort')
  })

  it('takes off and fields exactly, and treats anything else as sort', async () => {
    for (const [value, mode] of [['off', 'off'], ['fields', 'fields'], ['sort', 'sort'], ['FIELDS', 'sort'], ['on', 'sort']] as const) {
      const r = request()
      await refreshObservedRuntimesFlag(kv(value), r)
      expect(observedRuntimesModeFor(r), value).toBe(mode)
    }
  })

  it('keeps the last mode when KV fails or is missing', async () => {
    await refreshObservedRuntimesFlag(kv('fields'))
    const r = request()
    await refreshObservedRuntimesFlag(kv(new Error('kv down')), r)
    expect(observedRuntimesModeFor(r)).toBe('fields')
    await refreshObservedRuntimesFlag(undefined)
    expect(observedRuntimesModeFor(request())).toBe('fields')
  })

  it('pins the mode a request started with', async () => {
    const a = request(), b = request()
    await refreshObservedRuntimesFlag(kv('fields'), a)
    await refreshObservedRuntimesFlag(kv('off'), b)
    expect(observedRuntimesModeFor(a)).toBe('fields')
    expect(observedRuntimesModeFor(b)).toBe('off')
  })
})
