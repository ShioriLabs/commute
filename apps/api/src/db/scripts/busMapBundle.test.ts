import { describe, expect, it } from 'vitest'
import { decodePolyline, encodePolyline, type LngLat } from '../../utils/polyline'
import { bundle, bundleOrder, dropBypasses, placeStops, roundCorners, type BundleLine } from './busMapBundle'
import { networkStats } from './busMapStats'

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

  it('takes lines round a roundabout on its ring, as Transit draws one, never through its middle', () => {
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

    const fromMiddle = ([lng, lat]: LngLat): number => Math.hypot((lng - LNG) * M_LNG, (lat - LAT) * M_LAT)
    const points = edges.flatMap(e => decodePolyline(e.shape))
    // Nothing cuts across the fountain: every point stays out on the ring or the streets.
    expect(Math.min(...points.map(fromMiddle))).toBeGreaterThan(25)
    // And the ring is drawn: points all the way round it, near its 40 m radius.
    const onRing = points.filter(p => Math.abs(fromMiddle(p) - 40) < 8)
    expect(onRing.length).toBeGreaterThan(6)
  })

  it('puts the line turning left on the left before the turn, whatever the bundle order', () => {
    // 1 and 2 run north together, then 1 turns east and 2 west. Bundle order alone puts 1 on the
    // left, so it would cross 2 at the split.
    const at = (x: number, y: number): LngLat => [LNG + x / M_LNG, LAT + y / M_LAT]
    const up = Array.from({ length: 21 }, (_, k) => at(0, k * 50))
    const east = Array.from({ length: 16 }, (_, k) => at((k + 1) * 50, 1000))
    const west = Array.from({ length: 16 }, (_, k) => at(-(k + 1) * 50, 1000))
    const edges = bundle([line('1', 'BRT', [...up, ...east]), line('2', 'BRT', [...up, ...west])])
    const stats = networkStats(edges)
    expect(stats.splitCrossings).toBe(0)
    expect(stats.sameCrossings).toBe(0)
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

describe('roundCorners', () => {
  const at = (x: number, y: number): LngLat => [LNG + x / M_LNG, LAT + y / M_LAT]
  const metres = ([lng, lat]: LngLat): [number, number] => [(lng - LNG) * M_LNG, (lat - LAT) * M_LAT]

  it('turns a corner on one circle, wider for a wider bundle', () => {
    const corner = [at(0, 0), at(0, 500), at(500, 500)]
    const narrow = roundCorners(corner, 1).map(metres)
    const wide = roundCorners(corner, 8).map(metres)
    // Ends stay put.
    expect(narrow[0]![0]).toBeCloseTo(0, 1)
    expect(narrow[narrow.length - 1]![0]).toBeCloseTo(500, 1)
    // A right turn round a centre east of the corner: every arc point the same distance from it.
    const radiusOf = (pts: [number, number][]): number => {
      const arc = pts.slice(1, -1)
      const r = 500 - arc[0]![1]
      const cx = r
      const cy = 500 - r
      for (const [x, y] of arc) expect(Math.hypot(x - cx, y - cy)).toBeCloseTo(r, 0)
      return r
    }
    expect(radiusOf(wide)).toBeGreaterThan(radiusOf(narrow))
  })

  it('keeps a corner as wide as its legs allow', () => {
    const tight = roundCorners([at(0, 0), at(0, 30), at(30, 30)], 10).map(metres)
    for (const [x, y] of tight) {
      expect(x).toBeGreaterThan(-0.5)
      expect(y).toBeLessThan(30.5)
    }
  })

  it('leaves a gentle bend as it is', () => {
    const gentle = [at(0, 0), at(0, 500), at(50, 1000)]
    expect(roundCorners(gentle, 3)).toHaveLength(3)
  })
})

describe('placeStops', () => {
  it('puts a halte on the bundle carrying its lines, turned to the street', () => {
    const north = { shape: encodePolyline([[LNG, LAT], [LNG, LAT + 1000 / M_LAT]]), lines: ['1', '6A'] }
    const other = { shape: encodePolyline([[LNG + 30 / M_LNG, LAT], [LNG + 30 / M_LNG, LAT + 1000 / M_LAT]]), lines: ['9'] }
    const marks = placeStops([north, other], [{ code: 'H1', lng: LNG + 20 / M_LNG, lat: LAT + 500 / M_LAT, lines: ['1'] }])
    expect(marks).toHaveLength(1)
    const [code, lng, , bearing, count] = marks[0]!
    expect(code).toBe('H1')
    expect(Math.abs((lng - LNG) * M_LNG)).toBeLessThan(1)
    expect(bearing).toBe(0)
    expect(count).toBe(2)
  })

  it('leaves out a halte with none of its lines near', () => {
    const edge = { shape: encodePolyline([[LNG, LAT], [LNG, LAT + 1000 / M_LAT]]), lines: ['1'] }
    expect(placeStops([edge], [{ code: 'H2', lng: LNG + 500 / M_LNG, lat: LAT, lines: ['1'] }])).toEqual([])
  })
})

describe('roundCorners on a hairpin', () => {
  it('leaves a U-turn sharp rather than looping it', () => {
    const at = (x: number, y: number): LngLat => [LNG + x / M_LNG, LAT + y / M_LAT]
    const hairpin = [at(0, 0), at(0, 500), at(20, 0)]
    expect(roundCorners(hairpin, 6)).toHaveLength(3)
  })
})

describe('dropBypasses', () => {
  const at = (x: number, y: number): LngLat => [LNG + x / M_LNG, LAT + y / M_LAT]
  const run = (...pts: [number, number][]): LngLat[] => pts.map(([x, y]) => at(x, y))

  it('keeps one way round a loop: the other side is a bypass', () => {
    // Main path north through a roundabout's west side; the other direction round its east side.
    const main = run([0, 0], [0, 950], [-50, 1000], [0, 1050], [0, 2000])
    const east = run([0, 950], [50, 1000], [0, 1050])
    expect(dropBypasses([main, east])).toEqual([main])
  })

  it('keeps a branch that goes somewhere else', () => {
    const main = run([0, 0], [0, 2000])
    const branch = run([0, 1000], [800, 1000], [800, 1800])
    expect(dropBypasses([main, branch])).toHaveLength(2)
  })

  it('keeps a long detour the main path does not run alongside', () => {
    // Leaves and rejoins 100 m apart, but goes 2 km round: not the same way, a loop of its own.
    const main = run([0, 0], [0, 2000])
    const loop = run([0, 1000], [900, 1000], [900, 1100], [0, 1100])
    expect(dropBypasses([main, loop])).toHaveLength(2)
  })
})
