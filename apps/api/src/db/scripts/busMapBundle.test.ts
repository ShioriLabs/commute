import { describe, expect, it } from 'vitest'
import { decodePolyline, type LngLat } from '../../utils/polyline'
import { bundle, bundleOrder, type BundleLine } from './busMapBundle'

/*
 * Synthetic streets near Monas, as generateBusMap.test.ts draws them: 0.001
 * degree is ~110 m either way at -6.2.
 */
const LAT = -6.18
const LNG = 106.82
const M_LNG = 110_670
const M_LAT = 110_574

/** A street running north, `eastM` east of LNG, from `fromM` to `toM` north of LAT, a vertex every 50 m. */
const north = (fromM: number, toM: number, eastM = 0): LngLat[] => {
  const pts: LngLat[] = []
  const step = fromM <= toM ? 50 : -50
  for (let m = fromM; step > 0 ? m <= toM : m >= toM; m += step) pts.push([LNG + eastM / M_LNG, LAT + m / M_LAT])
  return pts
}

const line = (code: string, kind: 'BRT' | 'AUI', ...pieces: LngLat[][]): BundleLine => ({ code, kind, pieces })

/** The edges a line is drawn on, with where it sits across each (its index of how many). */
const placesOf = (edges: ReturnType<typeof bundle>, code: string) =>
  edges.filter(e => e.lines.includes(code)).map(e => ({ at: e.lines.indexOf(code), of: e.lines.length, northward: northward(e.shape) }))

const northward = (shape: string): boolean => {
  const pts = decodePolyline(shape)
  return pts[pts.length - 1]![1] > pts[0]![1]
}

/** Where a line lies across a north-south street, west (0) to east, whichever way the edge runs. */
const fromWest = (place: { at: number, of: number, northward: boolean }): number =>
  place.northward ? place.at : place.of - 1 - place.at

describe('bundleOrder', () => {
  it('puts koridors first, then by number', () => {
    const order = bundleOrder([
      { code: '10', kind: 'BRT' },
      { code: '4B', kind: 'AUI' },
      { code: '1A', kind: 'BRT' },
      { code: '1', kind: 'BRT' },
      { code: '2', kind: 'BRT' }
    ])
    expect(order).toEqual(['1', '1A', '2', '10', '4B'])
  })
})

describe('bundle', () => {
  it('draws a line alone as its street', () => {
    const edges = bundle([line('1', 'BRT', north(0, 2000))])
    expect(edges.map(e => e.lines)).toEqual([['1']])
  })

  it('lays lines sharing a street side by side, on one edge, in bundle order', () => {
    const edges = bundle([
      line('6B', 'BRT', north(0, 2000, 5)),
      line('1', 'BRT', north(0, 2000)),
      line('6A', 'BRT', north(2000, 0, 10))
    ])
    expect(edges).toHaveLength(1)
    expect(edges[0]!.lines).toEqual(['1', '6A', '6B'])
  })

  it('draws a line up one carriageway and back down the other once', () => {
    // Koridor 1 on Thamrin: one out-and-back piece, the carriageways ~31 m apart.
    const edges = bundle([line('1', 'BRT', [...north(0, 2000), ...north(2000, 0, 31)])])
    const total = edges.reduce((m, e) => m + decodePolyline(e.shape).length, 0)
    expect(edges.every(e => e.lines.length === 1)).toBe(true)
    // About one street's worth of points, not two.
    expect(total).toBeLessThan(2000 / 4 * 1.5)
  })

  it('keeps a street a block over its own', () => {
    const edges = bundle([line('1', 'BRT', north(0, 2000)), line('1H', 'BRT', north(0, 2000, 200))])
    expect(edges).toHaveLength(2)
    expect(edges.every(e => e.lines.length === 1)).toBe(true)
  })

  it('meets lines at a roundabout in one node, not round its ring', () => {
    // A roundabout, schematically: a ring 80 m across, one line north to
    // south round its east side, one east to west round its north side.
    const at = (x: number, y: number): LngLat => [LNG + x / M_LNG, LAT + y / M_LAT]
    const arc = (from: number, to: number): LngLat[] => {
      const pts: LngLat[] = []
      for (let k = 0; k <= 8; k++) {
        const a = ((from + ((to - from) * k) / 8) * Math.PI) / 180
        pts.push(at(40 * Math.cos(a), 40 * Math.sin(a)))
      }
      return pts
    }
    const straight = (x0: number, y0: number, x1: number, y1: number): LngLat[] =>
      Array.from({ length: 21 }, (_, k) => at(x0 + ((x1 - x0) * k) / 20, y0 + ((y1 - y0) * k) / 20))
    const southward = [...straight(0, 1000, 0, 40), ...arc(90, -90).slice(1), ...straight(0, -40, 0, -1000).slice(1)]
    const westward = [...straight(1000, 0, 40, 0), ...arc(0, 180).slice(1), ...straight(-40, 0, -1000, 0).slice(1)]
    const edges = bundle([line('1', 'BRT', southward), line('2', 'BRT', westward)])

    const ends = edges.flatMap((e) => {
      const pts = decodePolyline(e.shape)
      return [pts[0]!, pts[pts.length - 1]!]
    })
    const nearMiddle = ends.filter(([lng, lat]) => Math.hypot((lng - LNG) * M_LNG, (lat - LAT) * M_LAT) < 100)
    // Every street ending at the roundabout ends at the same point.
    expect(nearMiddle.length).toBeGreaterThanOrEqual(4)
    expect(new Set(nearMiddle.map(p => p.join(','))).size).toBe(1)
    // Nothing left going round: no edge has both ends at the roundabout.
    expect(edges.filter((e) => {
      const pts = decodePolyline(e.shape)
      return [pts[0]!, pts[pts.length - 1]!].every(([lng, lat]) => Math.hypot((lng - LNG) * M_LNG, (lat - LAT) * M_LAT) < 100)
    })).toHaveLength(0)
  })

  it('keeps every line on its side of the street where a line joins', () => {
    // 1 and 6A run the whole street; 9D joins from the east halfway up.
    const joining: LngLat[] = [[LNG + 800 / M_LNG, LAT + 1000 / M_LAT], ...north(1000, 2000, 8)]
    const edges = bundle([
      line('1', 'BRT', north(0, 2000)),
      line('6A', 'BRT', north(2000, 0, 6)),
      line('9D', 'BRT', joining)
    ])
    const one = placesOf(edges, '1').filter(p => p.of > 1).map(fromWest)
    const sixA = placesOf(edges, '6A').filter(p => p.of > 1).map(fromWest)
    // 1 stays west of 6A on every shared edge, before and after 9D joins.
    for (let i = 0; i < Math.min(one.length, sixA.length); i++) expect(one[i]).toBeLessThan(sixA[i]!)
    expect(edges.some(e => e.lines.length === 3)).toBe(true)
  })
})
