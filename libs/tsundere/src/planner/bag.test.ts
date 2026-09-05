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

  /*
   * Two lines running the same road carry independently measured distances, so
   * one is always a few metres better than the other. If that lets it dominate,
   * the loser's state is gone — and with it any journey that had to stay on the
   * losing line. TJ 6 beat 6V into Warung Buncit by 360m and deleted the only
   * line that continues to Pasar Santa.
   */
  it('does not let a label dominate one that arrived on a different line', () => {
    const bag = new Bag<string>({ maxSize: 8 })
    bag.insert(label({ rideDistanceM: 5679 }, '6', 'six'))
    expect(bag.insert(label({ rideDistanceM: 6039 }, '6V', 'sixV'))).toBe(true)
    expect(bag.labels().map(l => l.trace)).toEqual(['six', 'sixV'])
  })

  it('still evicts a worse label that arrived on the same line', () => {
    const bag = new Bag<string>({ maxSize: 8 })
    bag.insert(label({ rideDistanceM: 6039 }, '6V', 'long'))
    expect(bag.insert(label({ rideDistanceM: 5679 }, '6V', 'short'))).toBe(true)
    expect(bag.labels().map(l => l.trace)).toEqual(['short'])
  })

  /*
   * The destination front is not a state — the journey is over, so the line the
   * rider arrived on decides nothing further and two journeys there are directly
   * comparable.
   */
  describe('comparesAcrossLines', () => {
    it('compares labels from different lines against each other', () => {
      const bag = new Bag<string>({ maxSize: 8, comparesAcrossLines: true })
      bag.insert(label({ rideDistanceM: 5679 }, '6', 'six'))
      expect(bag.insert(label({ rideDistanceM: 6039 }, '6V', 'sixV'))).toBe(false)
      expect(bag.labels().map(l => l.trace)).toEqual(['six'])
    })

    it('drops an equal-cost journey that only differs by the line it arrived on', () => {
      const bag = new Bag<string>({ maxSize: 8, comparesAcrossLines: true })
      bag.insert(label({}, 'C', 'first'))
      expect(bag.insert(label({}, 'M', 'second'))).toBe(false)
      expect(bag.size).toBe(1)
    })
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

    it('spares a line\'s only label and evicts the next-worst instead', () => {
      const bag = new Bag<string>({ maxSize: 2 })
      // Two on line A, the second of them the worst in the bag.
      bag.insert(label({ walkDistanceM: 0, waitS: 0 }, 'A', 'a-good'))
      bag.insert(label({ walkDistanceM: 300, waitS: 600 }, 'A', 'a-bad'))
      // Sole representative of B, and worse still on the weighted sum — the old
      // rule would have taken it and left B with no state at all.
      bag.insert(label({ walkDistanceM: 900, waitS: 900 }, 'B', 'b-only'))

      expect(bag.size).toBe(2)
      expect(bag.labels().map(l => l.trace).sort()).toEqual(['a-good', 'b-only'])
    })

    it('falls back to the global worst when every label is alone on its line', () => {
      const bag = new Bag<string>({ maxSize: 2 })
      bag.insert(label({ walkDistanceM: 0, waitS: 0 }, 'A', 'best'))
      bag.insert(label({ walkDistanceM: 300, waitS: 300 }, 'B', 'middle'))
      // No protected-free victim exists, so the cap stays hard and the worst
      // goes. This is the residual loss the floor cannot cover.
      bag.insert(label({ walkDistanceM: 9000, waitS: 900 }, 'C', 'worst'))

      expect(bag.size).toBe(2)
      expect(bag.labels().map(l => l.trace).sort()).toEqual(['best', 'middle'])
    })

    it('ignores the floor when comparing across lines', () => {
      // The destination bag: the journey is over, so the line a rider arrived on
      // decides nothing and must not buy a worse journey its place.
      const bag = new Bag<string>({ maxSize: 2, comparesAcrossLines: true })
      // Mutually non-dominated (each wins an axis), so all three reach the cap
      // and eviction is what decides between them.
      bag.insert(label({ walkDistanceM: 0, waitS: 900 }, 'A', 'a-good'))
      bag.insert(label({ walkDistanceM: 300, waitS: 0 }, 'A', 'a-bad'))
      bag.insert(label({ walkDistanceM: 9000, waitS: 60 }, 'B', 'b-only'))

      expect(bag.size).toBe(2)
      expect(bag.labels().map(l => l.trace).sort()).toEqual(['a-bad', 'a-good'])
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
