import { describe, expect, it } from 'vitest'
import type { FareResultLeg } from '@commute/schemas'
import { hopsOf, mergeConsecutiveWalks, roundWalkM, stripWalkHops } from 'utils/merge-walks'

const station = (id: string) => ({ id, name: `Name:${id}` })
const walk = (from: string, to: string, distanceM: number, extra: { fare?: number, corridorLabel?: string } = {}): FareResultLeg => ({
  type: 'TRANSFER',
  from: station(from),
  to: station(to),
  distanceM,
  ...extra
})
const ride = (from: string, to: string): FareResultLeg => ({
  type: 'RIDE',
  line: 'KCI:C',
  operator: 'KCI',
  from: station(from),
  to: station(to),
  stationCount: 2,
  stops: [station(from), station(to)],
  headsign: null,
  distanceM: 1000
})

describe('roundWalkM', () => {
  it('rounds up to 50 m under 500 m', () => {
    expect(roundWalkM(40)).toBe(50)
    expect(roundWalkM(50)).toBe(50)
    expect(roundWalkM(51)).toBe(100)
    expect(roundWalkM(460)).toBe(500)
    expect(roundWalkM(499)).toBe(500)
  })

  it('rounds up to 100 m from 500 m', () => {
    expect(roundWalkM(500)).toBe(500)
    expect(roundWalkM(501)).toBe(600)
    expect(roundWalkM(650)).toBe(700)
    expect(roundWalkM(700)).toBe(700)
  })

  it('judges the band on the sum, not on how it rounds', () => {
    // 480 is under 500, so it goes to 500 on the 50 step; 520 is over, so 600.
    expect(roundWalkM(480)).toBe(500)
    expect(roundWalkM(520)).toBe(600)
  })
})

describe('mergeConsecutiveWalks', () => {
  it('folds two walks into one that ends at the last destination', () => {
    const { legs, absorbed } = mergeConsecutiveWalks([walk('A', 'B', 560), walk('B', 'C', 90), ride('C', 'D')])
    expect(legs).toHaveLength(2)
    expect(legs[0]).toMatchObject({ type: 'TRANSFER', from: { id: 'A' }, to: { id: 'C' }, distanceM: 700 })
    expect(absorbed).toBe(1)
  })

  it('folds a run of three', () => {
    const { legs, absorbed } = mergeConsecutiveWalks([walk('A', 'B', 100), walk('B', 'C', 100), walk('C', 'D', 100)])
    expect(legs).toEqual([{ type: 'TRANSFER', from: station('A'), to: station('D'), distanceM: 300, hopsM: [100, 100, 100] }])
    expect(absorbed).toBe(2)
  })

  it('leaves a lone walk at its exact distance', () => {
    const input = [ride('A', 'B'), walk('B', 'C', 90), ride('C', 'D')]
    const { legs, absorbed } = mergeConsecutiveWalks(input)
    expect(legs).toEqual(input)
    expect(absorbed).toBe(0)
    expect(hopsOf(legs[1]!)).toBeUndefined()
  })

  it('does not merge walks that a ride separates', () => {
    const { legs } = mergeConsecutiveWalks([walk('A', 'B', 90), ride('B', 'C'), walk('C', 'D', 90)])
    expect(legs).toHaveLength(3)
  })

  it('keeps a paid corridor on its own row', () => {
    const paid = walk('B', 'C', 200, { fare: 3000, corridorLabel: 'Dukuh Atas' })
    const { legs, absorbed } = mergeConsecutiveWalks([walk('A', 'B', 90), paid, walk('C', 'D', 90)])
    expect(legs).toHaveLength(3)
    expect(legs[1]).toBe(paid)
    expect(absorbed).toBe(0)
  })

  it('merges two groups independently', () => {
    const { legs, absorbed } = mergeConsecutiveWalks([walk('A', 'B', 30), walk('B', 'C', 30), ride('C', 'D'), walk('D', 'E', 20), walk('E', 'F', 20)])
    expect(legs.map(leg => leg.type === 'TRANSFER' ? leg.distanceM : 'ride')).toEqual([100, 'ride', 50])
    expect(absorbed).toBe(2)
  })

  it('returns nothing to merge for an empty journey', () => {
    expect(mergeConsecutiveWalks([])).toEqual({ legs: [], absorbed: 0 })
  })
})

describe('the hops behind a merged walk', () => {
  it('keeps each hop\'s raw distance, unmeasured ones included', () => {
    // 0 means UNMEASURED: it is exactly the hop the timing must still floor.
    const { legs } = mergeConsecutiveWalks([walk('A', 'B', 0), walk('B', 'C', 300)])
    expect(hopsOf(legs[0]!)).toEqual([0, 300])
  })

  it('stays flat when an already merged walk is merged again', () => {
    const [once] = mergeConsecutiveWalks([walk('A', 'B', 100), walk('B', 'C', 100)]).legs
    const { legs } = mergeConsecutiveWalks([once!, walk('C', 'D', 100)])
    expect(hopsOf(legs[0]!)).toEqual([100, 100, 100])
  })

  it('is stripped from a response, top-level legs and every journey\'s', () => {
    const merged = mergeConsecutiveWalks([walk('A', 'B', 100), walk('B', 'C', 100)]).legs
    const body = stripWalkHops({ legs: merged, journeys: [{ legs: merged, totalFare: 0 }] })
    expect(body.legs[0]).not.toHaveProperty('hopsM')
    expect(body.journeys[0]!.legs[0]).not.toHaveProperty('hopsM')
    expect(body.journeys[0]!.totalFare).toBe(0)
    // The cached original is untouched; the timing still needs it.
    expect(hopsOf(merged[0]!)).toEqual([100, 100])
  })
})

describe('mergeConsecutiveWalks exits', () => {
  const exit = (id: string) => ({ id, ref: id.split(':')[1]!, name: null })
  const pinned = (from: string, to: string, extra: { fromExit?: ReturnType<typeof exit>, toExit?: ReturnType<typeof exit> }): FareResultLeg =>
    ({ ...walk(from, to, 200), ...extra })

  it('keeps the first hop\'s fromExit and the last hop\'s toExit on a merged walk', () => {
    const { legs } = mergeConsecutiveWalks([
      pinned('A', 'B', { fromExit: exit('A:1'), toExit: exit('B:2') }),
      pinned('B', 'C', { fromExit: exit('B:3'), toExit: exit('C:4') })
    ])
    expect(legs).toHaveLength(1)
    expect(legs[0]).toMatchObject({ fromExit: { id: 'A:1' }, toExit: { id: 'C:4' } })
  })

  it('leaves a lone walk and an unpinned run without exit keys', () => {
    expect(mergeConsecutiveWalks([walk('A', 'B', 200), walk('B', 'C', 200)]).legs[0]).not.toHaveProperty('fromExit')
    const lone = pinned('A', 'B', { toExit: exit('B:2') })
    expect(mergeConsecutiveWalks([lone]).legs[0]).toBe(lone)
  })

  it('does not merge a run across a priced corridor walk, so each side keeps its own doors', () => {
    const { legs } = mergeConsecutiveWalks([
      pinned('A', 'B', { fromExit: exit('A:1'), toExit: exit('B:2') }),
      pinned('B', 'C', { fromExit: exit('B:3'), toExit: exit('C:4') }),
      walk('C', 'D', 300, { fare: 3000, corridorLabel: 'Transit berbayar' }),
      pinned('D', 'E', { fromExit: exit('D:5'), toExit: exit('E:6') })
    ])
    expect(legs).toHaveLength(3)
    expect(legs[0]).toMatchObject({ fromExit: { id: 'A:1' }, toExit: { id: 'C:4' } })
    expect(legs[1]).not.toHaveProperty('fromExit')
    expect(legs[2]).toMatchObject({ fromExit: { id: 'D:5' }, toExit: { id: 'E:6' } })
  })
})
