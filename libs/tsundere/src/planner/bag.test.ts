import { describe, expect, it } from 'vitest'
import { Bag } from './bag'
import type { Criteria } from './criteria'

const criteria = (over: Partial<Criteria> = {}): Criteria => ({
  boardings: 1,
  rideDistanceM: 5000,
  walkDistanceM: 200,
  concourseWalkM: 0,
  waitS: 300,
  fare: 3500,
  ...over
})

const label = (over: Partial<Criteria> = {}, incomingLine: string | null = 'C', trace = '') => ({
  criteria: criteria(over),
  incomingLine,
  trace
})

describe('Bag', () => {
  it('keeps the first label it is offered', () => {
    const bag = new Bag<string>({ maxSize: 8 })
    expect(bag.insert(label())).toBe(true)
    expect(bag.size).toBe(1)
  })

  it('rejects a label dominated by one already held', () => {
    const bag = new Bag<string>({ maxSize: 8 })
    bag.insert(label({ boardings: 1 }))
    expect(bag.insert(label({ boardings: 2 }))).toBe(false)
    expect(bag.size).toBe(1)
  })

  it('evicts labels the newcomer dominates', () => {
    const bag = new Bag<string>({ maxSize: 8 })
    bag.insert(label({ boardings: 2 }))
    expect(bag.insert(label({ boardings: 1 }))).toBe(true)
    expect(bag.size).toBe(1)
    expect(bag.labels()[0]!.criteria.boardings).toBe(1)
  })

  it('keeps both sides of a genuine tradeoff', () => {
    const bag = new Bag<string>({ maxSize: 8 })
    bag.insert(label({ boardings: 1, walkDistanceM: 900 }))
    bag.insert(label({ boardings: 2, walkDistanceM: 100 }))
    // Neither dominates: one walks less, the other changes less.
    expect(bag.size).toBe(2)
  })

  /*
   * Same criteria but a different boarded line is a different STATE, not a
   * duplicate — the onward line-change cost differs. Collapsing these is
   * exactly the bug the old scalar router had.
   */
  it('keeps equal-cost labels that arrived on different lines', () => {
    const bag = new Bag<string>({ maxSize: 8 })
    expect(bag.insert(label({}, 'C'))).toBe(true)
    expect(bag.insert(label({}, 'M'))).toBe(true)
    expect(bag.size).toBe(2)
  })

  it('rejects an exact duplicate that arrived on the same line', () => {
    const bag = new Bag<string>({ maxSize: 8 })
    bag.insert(label({}, 'C'))
    expect(bag.insert(label({}, 'C'))).toBe(false)
    expect(bag.size).toBe(1)
  })

  describe('size cap', () => {
    it('never grows past maxSize', () => {
      const bag = new Bag<string>({ maxSize: 3 })
      // Mutually non-dominated: each trades walking against waiting.
      for (let i = 0; i < 10; i++) {
        bag.insert(label({ walkDistanceM: i * 200, waitS: (10 - i) * 120 }, `L${i}`))
      }
      expect(bag.size).toBeLessThanOrEqual(3)
    })

    it('evicts the worst-ranked label, keeping the best', () => {
      const bag = new Bag<string>({ maxSize: 2 })
      bag.insert(label({ walkDistanceM: 0, waitS: 1200 }, 'A', 'slow'))
      bag.insert(label({ walkDistanceM: 2000, waitS: 0 }, 'B', 'walky'))
      // Better than both on the weighted sum, and non-dominated by either.
      bag.insert(label({ walkDistanceM: 100, waitS: 60 }, 'C', 'good'))

      expect(bag.size).toBe(2)
      expect(bag.labels().map(l => l.trace)).toContain('good')
    })

    it('reports false when the offered label is the one evicted', () => {
      const bag = new Bag<string>({ maxSize: 1 })
      bag.insert(label({ walkDistanceM: 0, waitS: 0 }, 'A', 'best'))
      // Non-dominated (more walking, less waiting) but ranks worse, so it loses
      // its own place — and the caller must not expand on it.
      const kept = bag.insert(label({ walkDistanceM: 9000, waitS: 0 }, 'B', 'worst'))
      expect(kept).toBe(false)
      expect(bag.labels()[0]!.trace).toBe('best')
    })
  })

  describe('isDominated', () => {
    it('is true for criteria beaten by a held label', () => {
      const bag = new Bag<string>({ maxSize: 8 })
      bag.insert(label({ boardings: 1 }))
      expect(bag.isDominated(criteria({ boardings: 3 }))).toBe(true)
    })

    it('is false for criteria nothing beats', () => {
      const bag = new Bag<string>({ maxSize: 8 })
      bag.insert(label({ boardings: 2, walkDistanceM: 1000 }))
      expect(bag.isDominated(criteria({ boardings: 2, walkDistanceM: 100 }))).toBe(false)
    })

    it('is false on an empty bag', () => {
      expect(new Bag<string>({ maxSize: 8 }).isDominated(criteria())).toBe(false)
    })
  })
})
