import { describe, expect, it } from 'vitest'
import { MinHeap } from './heap'

/*
 * The heap replaces a linear scan over `dist`, so the property that matters is
 * not "is it a valid heap" but "does it hand back the same node the scan would
 * have picked" — the minimum, every time, including after decrease-key pushes.
 */
describe('MinHeap', () => {
  it('is empty on construction', () => {
    expect(new MinHeap<string>().pop()).toBeUndefined()
  })

  it('pops a single item', () => {
    const h = new MinHeap<string>()
    h.push('a', 5)
    expect(h.pop()).toBe('a')
    expect(h.pop()).toBeUndefined()
  })

  it('pops in priority order, not insertion order', () => {
    const h = new MinHeap<string>()
    h.push('c', 3)
    h.push('a', 1)
    h.push('d', 4)
    h.push('b', 2)
    expect([h.pop(), h.pop(), h.pop(), h.pop()]).toEqual(['a', 'b', 'c', 'd'])
  })

  it('handles duplicate priorities without losing items', () => {
    const h = new MinHeap<string>()
    h.push('a', 1)
    h.push('b', 1)
    h.push('c', 1)
    const got = [h.pop(), h.pop(), h.pop()]
    expect(got.sort()).toEqual(['a', 'b', 'c'])
    expect(h.pop()).toBeUndefined()
  })

  /*
   * Dijkstra relaxes an edge by pushing the same node again at a lower cost
   * rather than repositioning the old entry (lazy deletion). The heap must
   * surface the improved entry first; the stale one is discarded by the
   * caller's visited check.
   */
  it('surfaces an improved priority before the stale entry', () => {
    const h = new MinHeap<string>()
    h.push('a', 10)
    h.push('b', 5)
    h.push('a', 1)
    expect(h.pop()).toBe('a')
    expect(h.pop()).toBe('b')
    expect(h.pop()).toBe('a')
  })

  it('interleaves pushes and pops correctly', () => {
    const h = new MinHeap<number>()
    h.push(5, 5)
    h.push(3, 3)
    expect(h.pop()).toBe(3)
    h.push(1, 1)
    h.push(4, 4)
    expect(h.pop()).toBe(1)
    expect(h.pop()).toBe(4)
    expect(h.pop()).toBe(5)
  })

  // The scan it replaces was exact, so the heap has to be too — a fuzz check
  // against a plain sort is the cheapest way to say that convincingly.
  it('matches a sorted order over many pseudo-random priorities', () => {
    const h = new MinHeap<number>()
    const priorities: number[] = []
    // Deterministic LCG: a fixed sequence reproduces on failure.
    let seed = 42
    for (let i = 0; i < 500; i++) {
      seed = (seed * 1103515245 + 12345) % 2147483648
      const p = seed % 10000
      priorities.push(p)
      h.push(p, p)
    }
    const popped: number[] = []
    for (;;) {
      const next = h.pop()
      if (next === undefined) break
      popped.push(next)
    }
    expect(popped).toEqual([...priorities].sort((a, b) => a - b))
  })

  it('reports its size', () => {
    const h = new MinHeap<string>()
    expect(h.size).toBe(0)
    h.push('a', 1)
    h.push('b', 2)
    expect(h.size).toBe(2)
    h.pop()
    expect(h.size).toBe(1)
  })
})
