import { describe, expect, it, vi } from 'vitest'
import { memoize } from 'utils/memo'

describe('memoize', () => {
  it('computes once per key and returns the same instance', () => {
    const cache = new Map<string, object>()
    const compute = vi.fn(() => ({}))

    const first = memoize(cache, 'a', compute)
    const second = memoize(cache, 'a', compute)

    expect(second).toBe(first)
    expect(compute).toHaveBeenCalledTimes(1)
  })

  it('keeps keys independent', () => {
    const cache = new Map<string, number>()
    expect(memoize(cache, 'a', () => 1)).toBe(1)
    expect(memoize(cache, 'b', () => 2)).toBe(2)
  })

  it('caches falsy values instead of recomputing them', () => {
    const cache = new Map<string, number>()
    const compute = vi.fn(() => 0)

    memoize(cache, 'zero', compute)
    memoize(cache, 'zero', compute)

    expect(compute).toHaveBeenCalledTimes(1)
  })
})
