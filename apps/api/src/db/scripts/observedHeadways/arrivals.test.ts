import { describe, expect, it } from 'vitest'
import { buildOrder, DEFAULT_ARRIVAL_OPTIONS, extractArrivals } from './arrivals'
import type { Obs } from './snapshots'

const order = buildOrder([
  {
    operator: 'TJ',
    lineCode: 'T',
    path: [{ station: 'A' }, { station: 'B' }, { station: 'C' }, { station: 'D' }],
    pathReverse: [{ station: 'D' }, { station: 'C' }, { station: 'B' }, { station: 'A' }]
  },
  {
    operator: 'TJ',
    lineCode: 'U',
    path: [{ station: 'A' }, { station: 'B' }],
    pathReverse: [{ station: 'B' }, { station: 'A' }]
  }
] as never)

const obs = (t: number, next: string, route = 'T'): Obs => ({ t, route, next })

describe('extractArrivals', () => {
  it('credits an adjacent step to the stop the bus was heading for', () => {
    const { arrivals, stats } = extractArrivals([[obs(0, 'A'), obs(30_000, 'B')]], order, DEFAULT_ARRIVAL_OPTIONS)
    expect([...arrivals.keys()]).toEqual(['T@TJ-A@F'])
    expect(arrivals.get('T@TJ-A@F')).toEqual([15_000])
    expect(stats.adjacent).toBe(1)
  })

  it('infers the reverse direction from stop order', () => {
    const { arrivals } = extractArrivals([[obs(0, 'D'), obs(30_000, 'C')]], order, DEFAULT_ARRIVAL_OPTIONS)
    expect([...arrivals.keys()]).toEqual(['T@TJ-D@R'])
  })

  it('credits stops passed inside one interval with interpolated times', () => {
    const { arrivals, stats } = extractArrivals([[obs(0, 'A'), obs(40_000, 'C')]], order, DEFAULT_ARRIVAL_OPTIONS)
    expect(arrivals.get('T@TJ-A@F')).toEqual([10_000])
    expect(arrivals.get('T@TJ-B@F')).toEqual([30_000])
    expect(stats.jump).toBe(1)
  })

  it('credits only the first stop when interpolation is off', () => {
    const { arrivals } = extractArrivals([[obs(0, 'A'), obs(40_000, 'C')]], order, { ...DEFAULT_ARRIVAL_OPTIONS, interpolate: false })
    expect([...arrivals.keys()]).toEqual(['T@TJ-A@F'])
  })

  it('drops observations too far apart to bound an arrival', () => {
    const { arrivals, stats } = extractArrivals([[obs(0, 'A'), obs(301_000, 'B')]], order, DEFAULT_ARRIVAL_OPTIONS)
    expect(arrivals.size).toBe(0)
    expect(stats.wideGap).toBe(1)
  })

  it('ignores a bus that changed route between observations', () => {
    const { arrivals, stats } = extractArrivals([[obs(0, 'A', 'T'), obs(30_000, 'B', 'U')]], order, DEFAULT_ARRIVAL_OPTIONS)
    expect(arrivals.size).toBe(0)
    expect(stats.routeChange).toBe(1)
  })

  it('ignores a repeated next stop and a bus with no next stop', () => {
    const { arrivals, stats } = extractArrivals([[obs(0, 'A'), obs(30_000, 'A'), obs(60_000, '')]], order, DEFAULT_ARRIVAL_OPTIONS)
    expect(arrivals.size).toBe(0)
    expect(stats.transitions).toBe(0)
  })

  it('filters arrivals by time with `keep`', () => {
    const { arrivals } = extractArrivals([[obs(0, 'A'), obs(30_000, 'B')]], order, { ...DEFAULT_ARRIVAL_OPTIONS, keep: t => t > 20_000 })
    expect(arrivals.size).toBe(0)
  })
})
