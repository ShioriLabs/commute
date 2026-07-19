import { describe, expect, it } from 'vitest'
import { mapify } from 'utils/mapify'

describe('mapify', () => {
  it('keys items by the key function', () => {
    const items = [{ id: 'a', n: 1 }, { id: 'b', n: 2 }]
    const map = mapify(items, item => item.id)
    expect(map.size).toBe(2)
    expect(map.get('a')).toBe(items[0])
    expect(map.get('b')).toBe(items[1])
  })

  it('returns an empty Map for an empty array', () => {
    expect(mapify([], (x: { id: string }) => x.id).size).toBe(0)
  })

  it('last write wins on duplicate keys', () => {
    const first = { id: 'x', n: 1 }
    const second = { id: 'x', n: 2 }
    const map = mapify([first, second], item => item.id)
    expect(map.size).toBe(1)
    expect(map.get('x')).toBe(second)
  })

  it('supports non-string keys', () => {
    const map = mapify([{ k: 1 }, { k: 2 }], item => item.k)
    expect(map.get(1)).toEqual({ k: 1 })
  })

  it('propagates errors thrown by the key function', () => {
    const throwingKey = () => {
      throw new Error('boom')
    }
    expect(() => mapify([{ id: 'a' }], throwingKey)).toThrow('boom')
  })
})
