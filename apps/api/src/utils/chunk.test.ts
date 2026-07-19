import { describe, expect, it } from 'vitest'
import { chunkArray } from 'utils/chunk'

describe('chunkArray', () => {
  it('splits evenly', () => {
    expect(chunkArray([1, 2, 3, 4, 5, 6], 2)).toEqual([[1, 2], [3, 4], [5, 6]])
  })

  it('leaves a short final chunk on uneven division', () => {
    expect(chunkArray([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
  })

  it('defaults to size 10', () => {
    const arr = Array.from({ length: 25 }, (_, i) => i)
    const chunks = chunkArray(arr)
    expect(chunks).toHaveLength(3)
    expect(chunks[0]).toHaveLength(10)
    expect(chunks[2]).toHaveLength(5)
  })

  it('returns a single chunk when size exceeds length', () => {
    expect(chunkArray([1, 2, 3], 10)).toEqual([[1, 2, 3]])
  })

  it('returns [] for an empty array', () => {
    expect(chunkArray([])).toEqual([])
  })

  it('throws when size is 0', () => {
    expect(() => chunkArray([1, 2], 0)).toThrow('Size needs to be greater than 0')
  })

  it('throws when size is negative', () => {
    expect(() => chunkArray([1, 2], -3)).toThrow('Size needs to be greater than 0')
  })

  it('preserves element reference identity (shallow slice)', () => {
    const a = { id: 1 }
    const b = { id: 2 }
    const [chunk] = chunkArray([a, b], 2)
    expect(chunk[0]).toBe(a)
    expect(chunk[1]).toBe(b)
  })
})
