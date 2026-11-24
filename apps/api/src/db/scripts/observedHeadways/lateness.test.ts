import { describe, expect, it } from 'vitest'
import { arriveByBudgetS, fillHoles, replay, type StopPassings, type TripTimes } from './lateness'

const MIN = 60_000
const trip = (entries: [number, number][]): TripTimes => new Map(entries)
const opts = { maxWaitMs: 120 * MIN, activeWithinMs: 60 * MIN }

describe('fillHoles', () => {
  it('interpolates missing stops between two seen passings by index', () => {
    const at = trip([[1, 0], [4, 9 * MIN]])
    expect(fillHoles(at)).toBe(2)
    expect(at.get(2)).toBe(3 * MIN)
    expect(at.get(3)).toBe(6 * MIN)
  })

  it('leaves a hole longer than the limit alone', () => {
    const at = trip([[1, 0], [3, 25 * MIN]])
    expect(fillHoles(at)).toBe(0)
    expect(at.has(2)).toBe(false)
  })

  it('adds nothing to a trip without holes', () => {
    expect(fillHoles(trip([[1, 0], [2, MIN], [3, 2 * MIN]]))).toBe(0)
  })
})

describe('replay', () => {
  // Board at stop 2, alight at stop 5.
  const early = trip([[2, 0], [5, 20 * MIN]])
  const shortTurn = trip([[2, 30 * MIN], [3, 32 * MIN]])
  const through = trip([[2, 40 * MIN], [5, 58 * MIN]])
  const atBoard: StopPassings = [early, shortTurn, through].map(at => ({ t: at.get(2)!, at }))

  it('boards the first bus after t that reaches the alighting stop, skipping short-turns', () => {
    expect(replay(atBoard, 25 * MIN, 5, opts)).toEqual({ kind: 'rode', boardT: 40 * MIN, alightT: 58 * MIN, skipped: 1 })
  })

  it('never boards a bus that passed before the rider arrived', () => {
    const r = replay(atBoard, 1, 5, opts)
    expect(r.kind === 'rode' && r.boardT).toBe(40 * MIN)
  })

  it('is inactive before any bus has passed, or after a long silence', () => {
    expect(replay(atBoard, -1, 5, opts)).toEqual({ kind: 'inactive' })
    expect(replay([{ t: 0, at: early }, { t: 90 * MIN, at: through }], 70 * MIN, 5, opts)).toEqual({ kind: 'inactive' })
  })

  it('gives up past the longest wait', () => {
    expect(replay(atBoard, 25 * MIN, 5, { ...opts, maxWaitMs: 10 * MIN })).toEqual({ kind: 'noBus', skipped: 1 })
  })
})

describe('arriveByBudgetS', () => {
  it('budgets 1.5 headways of wait on frequent lines and one on long-headway lines', () => {
    expect(arriveByBudgetS(600, 900)).toBe(1800)
    expect(arriveByBudgetS(1200, 900)).toBe(2100)
  })
})
