import { describe, expect, it } from 'vitest'
import type { Passing } from './arrivals'
import { hops, splitTrips, TRIP_BREAK_MS } from './trips'

const p = (index: number, t: number, over: Partial<Passing> = {}): Passing =>
  ({ route: 'T', dir: 'F', stop: `S${index}`, index, t, span: 1, ...over })

describe('splitTrips', () => {
  it('keeps ascending passings on one line and direction as one trip', () => {
    const trips = splitTrips([p(0, 0), p(1, 60_000), p(3, 200_000)])
    expect(trips).toHaveLength(1)
    expect(trips[0]!.passings.map(x => x.index)).toEqual([0, 1, 3])
  })

  it('splits at the terminus turnaround', () => {
    const trips = splitTrips([p(0, 0), p(1, 60_000), p(0, 600_000, { dir: 'R' }), p(1, 660_000, { dir: 'R' })])
    expect(trips.map(t => t.dir)).toEqual(['F', 'R'])
  })

  it('splits when the index goes back on the same direction', () => {
    expect(splitTrips([p(2, 0), p(3, 60_000), p(0, 120_000)])).toHaveLength(2)
  })

  it('splits on a route change', () => {
    expect(splitTrips([p(0, 0), p(1, 60_000, { route: 'U' })])).toHaveLength(2)
  })

  it('splits passings further apart than the break', () => {
    expect(splitTrips([p(0, 0), p(1, TRIP_BREAK_MS + 1)])).toHaveLength(2)
    expect(splitTrips([p(0, 0), p(1, TRIP_BREAK_MS)])).toHaveLength(1)
  })
})

describe('hops', () => {
  it('times adjacent, directly observed passings', () => {
    const [trip] = splitTrips([p(0, 0), p(1, 90_000), p(2, 150_000)])
    expect(hops(trip!).map(h => [h.from, h.durationMs])).toEqual([[0, 90_000], [1, 60_000]])
  })

  it('skips holes and interpolated passings', () => {
    const [trip] = splitTrips([p(0, 0), p(2, 90_000), p(3, 100_000, { span: 2 }), p(4, 150_000, { span: 2 })])
    expect(hops(trip!)).toEqual([])
  })

  it('skips hops that overlap unhealthy time', () => {
    const [trip] = splitTrips([p(0, 0), p(1, 90_000), p(2, 150_000)])
    const unhealthy = { overlaps: (from: number, to: number) => from < 100_000 && to > 95_000 }
    expect(hops(trip!, unhealthy).map(h => h.from)).toEqual([0])
  })
})
