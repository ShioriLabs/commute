import { describe, expect, it } from 'vitest'
import { decodePolyline, encodePolyline, type LngLat } from '../../utils/polyline'
import {
  bundle,
  bundleOrder,
  dropBypasses,
  dropRetraces,
  dropShortLoops,
  loadSolver,
  orderCost,
  orderLinesExact,
  orderLinesLocal,
  placeStops,
  roundCorners,
  roundJunctions,
  simplifyBends,
  smoothPath,
  strokeCount,
  strokeKeys,
  type BundleLine,
  type BusMapEdge,
  type Chain,
  type CornerTally,
  type Network,
  type PairRule
} from './busMapBundle'
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

/** LNG in the bundler's metres (its KX), for a test's line drawn down the middle of a split road. */
const LNG_X = LNG * Math.cos((-6.2 * Math.PI) / 180) * 111_320

/** The edges a line is drawn on, with where it sits across each (its index of how many). */
const placesOf = (edges: BusMapEdge[], code: string) =>
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
  it('draws a line alone as its street', async () => {
    const edges = await bundle([line('1', 'BRT', north(0, 2000))])
    expect(edges.map(e => e.lines)).toEqual([['1']])
  })

  it('lays lines sharing a street side by side, on one edge, in bundle order', async () => {
    const edges = await bundle([
      line('6B', 'BRT', north(0, 2000, 5)),
      line('1', 'BRT', north(0, 2000)),
      line('6A', 'BRT', north(2000, 0, 10))
    ])
    expect(edges).toHaveLength(1)
    expect(edges[0]!.lines).toEqual(['1', '6A', '6B'])
  })

  it('draws a line up one carriageway and back down the other once', async () => {
    // Koridor 1 on Thamrin: one out-and-back piece, the carriageways ~31 m apart.
    const edges = await bundle([line('1', 'BRT', [...north(0, 2000), ...north(2000, 0, 31)])])
    const total = edges.reduce((m, e) => m + decodePolyline(e.shape).length, 0)
    expect(edges.every(e => e.lines.length === 1)).toBe(true)
    // About one street's worth of points, not two.
    expect(total).toBeLessThan(2000 / 4 * 1.5)
  })

  it('keeps a hairpin\'s legs apart, on the roads they run on', async () => {
    // Gambir 2: north up a road, round at the halte and back down the road 40 m beside it, then east.
    const at = (x: number, y: number): LngLat => [LNG + x / M_LNG, LAT + y / M_LAT]
    const up = Array.from({ length: 20 }, (_, k) => at(0, (k + 1) * 10))
    const back = Array.from({ length: 21 }, (_, k) => at(40, 200 - k * 10))
    const east = Array.from({ length: 20 }, (_, k) => at(40 + (k + 1) * 25, 0))
    const edges = await bundle([line('2', 'BRT', [...north(-1000, 0), ...up, at(20, 215), ...back, ...east])])
    const metres = ([lng, lat]: LngLat): [number, number] => [(lng - LNG) * M_LNG, (lat - LAT) * M_LAT]
    /** Whether a drawn segment runs north-south at [x] past y = 100. */
    const runsAt = (x: number): boolean => edges.some((e) => {
      const pts = decodePolyline(e.shape).map(metres)
      return pts.slice(1).some(([bx, by], k) => {
        const [ax, ay] = pts[k]!
        return Math.abs(ax - x) < 5 && Math.abs(bx - x) < 5 && Math.min(ay, by) < 100 && Math.max(ay, by) > 100
      })
    })
    expect(runsAt(0)).toBe(true)
    expect(runsAt(40)).toBe(true)
  })

  it('keeps a street a block over its own', async () => {
    const edges = await bundle([line('1', 'BRT', north(0, 2000)), line('1H', 'BRT', north(0, 2000, 200))])
    expect(edges).toHaveLength(2)
    expect(edges.every(e => e.lines.length === 1)).toBe(true)
  })

  it('takes lines round a roundabout on its ring, as Transit draws one, never through its middle', async () => {
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
    const edges = await bundle([line('1', 'BRT', southward), line('2', 'BRT', westward)])

    const fromMiddle = ([lng, lat]: LngLat): number => Math.hypot((lng - LNG) * M_LNG, (lat - LAT) * M_LAT)
    const points = edges.flatMap(e => decodePolyline(e.shape))
    // Nothing cuts across the fountain: every point stays out on the ring or the streets.
    expect(Math.min(...points.map(fromMiddle))).toBeGreaterThan(25)
    // And the ring is drawn: points all the way round it, near its 40 m radius.
    const onRing = points.filter(p => Math.abs(fromMiddle(p) - 40) < 8)
    expect(onRing.length).toBeGreaterThan(6)
  })

  it('puts the line turning left on the left before the turn, whatever the bundle order', async () => {
    // 1 and 2 run north together, then 1 turns east and 2 west. Bundle order alone puts 1 on the
    // left, so it would cross 2 at the split.
    const at = (x: number, y: number): LngLat => [LNG + x / M_LNG, LAT + y / M_LAT]
    const up = Array.from({ length: 21 }, (_, k) => at(0, k * 50))
    const east = Array.from({ length: 16 }, (_, k) => at((k + 1) * 50, 1000))
    const west = Array.from({ length: 16 }, (_, k) => at(-(k + 1) * 50, 1000))
    const edges = await bundle([line('1', 'BRT', [...up, ...east]), line('2', 'BRT', [...up, ...west])])
    const stats = networkStats(edges)
    expect(stats.splitCrossings).toBe(0)
    expect(stats.sameCrossings).toBe(0)
  })

  it('keeps every line on its side of the street where a line joins', async () => {
    // 1 and 6A run the whole street; 9D joins from the east halfway up.
    const joining: LngLat[] = [[LNG + 800 / M_LNG, LAT + 1000 / M_LAT], ...north(1000, 2000, 8)]
    const edges = await bundle([
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

  it('draws a road split by a toll road as two, its sides however near', async () => {
    // 10 north up one side of Yos Sudarso, 12 south down the other, 34 m apart: bundled, without a
    // toll road between them, as one street.
    const together = await bundle([line('10', 'BRT', north(0, 2000)), line('12', 'BRT', north(2000, 0, 34))])
    expect(together.some(e => e.lines.length === 2)).toBe(true)
    const keptApart = (a: [number, number], b: [number, number]): boolean => Math.sign(a[0] - LNG_X - 17) !== Math.sign(b[0] - LNG_X - 17)
    const split = await bundle([line('10', 'BRT', north(0, 2000)), line('12', 'BRT', north(2000, 0, 34))], undefined, keptApart)
    expect(split.every(e => e.lines.length === 1)).toBe(true)
  })

  it('keeps a one-way pair apart where its streets come close for a few dozen metres', async () => {
    // Harmoni to Pecenongan: eastbound on one bank of a canal, westbound on the other, 60 m apart but
    // 35 m for 50 m halfway. Merged there, the eastbound line dipped across and back.
    const at = (x: number, y: number): LngLat => [LNG + x / M_LNG, LAT + y / M_LAT]
    const bank = (y: (x: number) => number, from: number, to: number): LngLat[] => {
      const pts: LngLat[] = []
      for (let x = from; from < to ? x <= to : x >= to; x += from < to ? 10 : -10) pts.push(at(x, y(x)))
      return pts
    }
    const south = (x: number): number => (Math.abs(x) <= 25 ? -35 : Math.abs(x) >= 75 ? -60 : -35 - ((Math.abs(x) - 25) / 50) * 25)
    const edges = await bundle([
      line('2', 'BRT', bank(south, 1000, -1000)),
      line('3', 'BRT', bank(() => 0, -1000, 1000))
    ])
    expect(edges.every(e => e.lines.length === 1)).toBe(true)
  })

  it('moves a bundle across its street so the lines going straight on through a join keep their place', async () => {
    // 13 and 13E east along a street; 1 joins them from the north halfway and leaves to the south
    // 500 m on, as at CSW. Centred, the 13s would step half a line aside where 1 joins and back.
    const at = (x: number, y: number): LngLat => [LNG + x / M_LNG, LAT + y / M_LAT]
    const east = (from: number, to: number, y = 0): LngLat[] => Array.from({ length: (to - from) / 50 + 1 }, (_, k) => at(from + k * 50, y))
    const edges = await bundle([
      line('1', 'BRT', [...Array.from({ length: 10 }, (_, k) => at(0, 500 - k * 50)), ...east(0, 500), ...Array.from({ length: 10 }, (_, k) => at(500, -(k + 1) * 50))]),
      line('13', 'BRT', east(-1000, 1500)),
      line('13E', 'BRT', east(-1000, 1500, 3))
    ])
    /** Where [code] lies across each edge carrying it, in line widths right of the eastward way. */
    const places = (code: string): number[] => edges.filter(e => e.lines.includes(code) && e.lines.length > 1).map((e) => {
      const pts = decodePolyline(e.shape)
      const eastward = pts[pts.length - 1]![0] > pts[0]![0]
      const right = e.lines.indexOf(code) - (e.lines.length - 1) / 2 + (e.shift ?? 0)
      return eastward ? right : -right
    })
    expect(edges.some(e => e.lines.length === 3)).toBe(true)
    for (const code of ['13', '13E']) expect(new Set(places(code)).size).toBe(1)
  })

  it('keeps lines of one colour side by side, as one stroke, wherever they share a street', async () => {
    // 13 and L13E one purple, 1 red between them in bundle order: drawn as lines, 1 could sit
    // between the purples; as strokes it can't.
    const purple = '#7A357B'
    const edges = await bundle([
      { ...line('1', 'BRT', north(0, 2000, 3)), color: '#D62126' },
      { ...line('13', 'BRT', north(0, 2000)), color: purple },
      { ...line('L13E', 'BRT', north(0, 2000, 6)), color: purple.toLowerCase() }
    ])
    expect(edges).toHaveLength(1)
    const [lines] = edges.map(e => e.lines)
    expect(Math.abs(lines!.indexOf('13') - lines!.indexOf('L13E'))).toBe(1)
    const strokes = strokeKeys([{ code: '1', color: '#D62126' }, { code: '13', color: purple }, { code: 'L13E', color: purple.toLowerCase() }])
    expect(strokeCount(lines!, strokes)).toBe(2)
    // A halte there: a bar across two strokes, not three lines.
    const [mark] = placeStops(edges, [{ code: 'H', lng: LNG, lat: LAT + 1000 / M_LAT, lines: ['13'] }], strokes)
    expect(mark![4]).toBe(2)
  })

  it('merges a joining line in on its own side, as Transit\'s penalty figure has it', async () => {
    // 1 and 2 run north; 3 comes in from the west and joins them. Bundle order would put 3 on the
    // east, crossing both on the way in ("merging lines crossing"), or between them ("merging in
    // between"); drawn right it comes in on the west and crosses nothing ("no issues").
    const joining: LngLat[] = [[LNG - 800 / M_LNG, LAT + 1000 / M_LAT], ...north(1000, 2000, -6)]
    const edges = await bundle([
      line('1', 'BRT', north(0, 2000)),
      line('2', 'BRT', north(0, 2000, 6)),
      line('3', 'BRT', joining)
    ])
    const stats = networkStats(edges)
    expect(stats.splitCrossings).toBe(0)
    expect(stats.sameCrossings).toBe(0)
    const three = placesOf(edges, '3').filter(p => p.of === 3).map(fromWest)
    expect(three.length).toBeGreaterThan(0)
    expect(three.every(at => at === 0)).toBe(true)
  })
})

describe('dropShortLoops', () => {
  // Points in metres, around a node at the origin.
  const point = (x: number, y: number) => ({ x, y, ux: 0, uy: 1, piece: 0, index: 0 })
  const network = (pts: [number, number][]): Network => ({ points: pts.map(([x, y]) => point(x, y)), edges: new Map(), adjacency: new Map() })

  it('drops a teardrop off the network back to the node it left, keeps a loop round a block', () => {
    // Node 0; a 70 m teardrop off it (9 toward Cawang Sentral); a 600 m loop round a block; a street on.
    const net = network([[0, 0], [-25, 15], [-45, 0], [-25, -15], [-150, 0], [-150, 150], [0, 150], [0, 500]])
    const teardrop: Chain = { path: [0, 1, 2, 3, 0], lines: new Set(['9']) }
    const block: Chain = { path: [0, 4, 5, 6, 0], lines: new Set(['9']) }
    const street: Chain = { path: [0, 7], lines: new Set(['9']) }
    expect(dropShortLoops(net, [teardrop, block, street])).toEqual([block, street])
  })
})

describe('line order', () => {
  /*
   * Two chains of A and B meeting at a node, A and B going straight on from one
   * to the other; at each chain's far end they part, the way that wants B on
   * the left. Turning either chain alone crosses them at the middle node (4) to
   * save one split (1); only turning both at once gets to nothing.
   */
  const list: Chain[] = [
    { path: [0, 1], lines: new Set(['A', 'B']) },
    { path: [1, 2], lines: new Set(['A', 'B']) }
  ]
  const rules: PairRule[] = [
    { a: 'A', b: 'B', inChain: 0, inAtStart: false, outChain: 1, outAtStart: true, weight: 4 },
    { a: 'A', b: 'B', inChain: 0, inAtStart: true, aGoesLeft: true, weight: 1 },
    { a: 'A', b: 'B', inChain: 1, inAtStart: false, aGoesLeft: false, weight: 1 }
  ]
  const rank = new Map([['A', 0], ['B', 1]])

  it('finds by solving what moving one line at a time cannot', async () => {
    const local = orderLinesLocal(list, rules, rank)
    expect(orderCost(rules, local)).toBe(2)
    const exact = orderLinesExact(list, rules, rank, await loadSolver())
    expect(orderCost(rules, exact)).toBe(0)
    expect(exact).toEqual([['B', 'A'], ['B', 'A']])
  })

  it('keeps bundle order where no crossing asks otherwise', async () => {
    const calm: PairRule[] = [rules[0]!]
    expect(orderLinesExact(list, calm, rank, await loadSolver())).toEqual([['A', 'B'], ['A', 'B']])
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

  it('turns a chamfered corner on one circle at the full radius, as Transit\'s corner figure does', () => {
    // North, then 15 m north-east, then east: two 45° cuts, each too short a leg apart for 5 lines.
    const cut = 15 / Math.SQRT2
    const chamfer = [at(0, -500), at(0, 0), at(cut, cut), at(500, cut)]
    const tally: CornerTally = { eased: 0, junctions: 0, squeezed: 0, folded: 0 }
    const round = roundCorners(chamfer, 5, tally).map(metres)
    expect(tally.eased).toBe(1)
    expect(tally.squeezed).toBe(0)
    // The two legs meet at (0, cut); the circle of 15 + 14 × 5 = 85 m sits south-east of it.
    const r = 85
    const [cx, cy] = [r, cut - r]
    for (const [x, y] of round.slice(1, -1)) expect(Math.hypot(x - cx, y - cy)).toBeCloseTo(r, 0)
  })

  it('straightens a short jog rather than turning twice', () => {
    const jog = [at(0, 0), at(0, 500), at(5, 505), at(5, 1000)]
    expect(roundCorners(jog, 5)).toHaveLength(2)
  })
})

describe('roundJunctions', () => {
  const at = (x: number, y: number): LngLat => [LNG + x / M_LNG, LAT + y / M_LAT]
  const metres = ([lng, lat]: LngLat): [number, number] => [(lng - LNG) * M_LNG, (lat - LAT) * M_LAT]

  it('turns two edges meeting at a corner on one arc, and brings the node\'s other edges to its middle', () => {
    // 1 north up one edge and east along the next; 2 carries on north from the corner.
    const node = at(0, 500)
    const tally: CornerTally = { eased: 0, junctions: 0, squeezed: 0, folded: 0 }
    const [up, east, on, stub] = roundJunctions([
      { path: [at(0, 0), node], lines: ['1'] },
      { path: [node, at(500, 500)], lines: ['1'] },
      { path: [node, at(0, 1000)], lines: ['2'] },
      // An edge of no length there, as the network leaves one now and then: it goes with the node.
      { path: [node, node], lines: ['1'] }
    ], tally).map(p => p.map(metres))
    expect(tally.junctions).toBe(1)
    // Both halves on the circle of 15 + 14 = 29 m, centred south-east of the corner.
    const r = 29
    for (const [x, y] of [...up!.slice(1), ...east!.slice(0, -1)]) expect(Math.hypot(x - r, y - (500 - r))).toBeCloseTo(r, 0)
    // The three still meet, at the arc's middle.
    const middle = up![up!.length - 1]!
    expect(east![0]![0]).toBeCloseTo(middle[0], 6)
    expect(east![0]![1]).toBeCloseTo(middle[1], 6)
    expect(on![0]![0]).toBeCloseTo(middle[0], 6)
    expect(on![0]![1]).toBeCloseTo(middle[1], 6)
    for (const [x, y] of stub!) {
      expect(x).toBeCloseTo(middle[0], 6)
      expect(y).toBeCloseTo(middle[1], 6)
    }
  })

  it('leaves a node a line goes straight through where it is', () => {
    // 1 straight up through the node, 13E coming up with it and turning east: rounding 13E's corner
    // would move the node off 1's street.
    const node = at(0, 500)
    const edges = [
      { path: [at(0, 0), node], lines: ['1', '13E'] },
      { path: [node, at(0, 1000)], lines: ['1'] },
      { path: [node, at(500, 500)], lines: ['13E'] }
    ]
    const tally: CornerTally = { eased: 0, junctions: 0, squeezed: 0, folded: 0 }
    const out = roundJunctions(edges, tally)
    expect(tally.junctions).toBe(0)
    out.forEach((path, e) => {
      expect(path).toHaveLength(edges[e]!.path.length)
      path.forEach(([lng, lat], i) => {
        expect(lng).toBeCloseTo(edges[e]!.path[i]![0], 9)
        expect(lat).toBeCloseTo(edges[e]!.path[i]![1], 9)
      })
    })
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
  const metres = ([lng, lat]: LngLat): [number, number] => [(lng - LNG) * M_LNG, (lat - LAT) * M_LAT]
  /** Whether any point the pieces keep lies within [r] metres of (x, y). */
  const passes = (pieces: LngLat[][], x: number, y: number, r = 15): boolean =>
    pieces.flat().map(metres).some(([px, py]) => Math.hypot(px - x, py - y) < r)

  it('keeps one way round a roundabout: the other half is cut', () => {
    // Main path north round a roundabout's west side; the other direction round its east side.
    const main = run([0, 0], [0, 950], [-50, 1000], [0, 1050], [0, 2000])
    const east = run([0, 950], [50, 1000], [0, 1050])
    const kept = dropBypasses([main, east])
    expect(kept[0]).toEqual(main)
    expect(passes(kept, 50, 1000)).toBe(false)
  })

  it('cuts only the roundabout from a long opposite carriageway', () => {
    // The other direction 25 m east for 2 km, round the roundabout's east side halfway.
    const main = run([0, 0], [0, 950], [-50, 1000], [0, 1050], [0, 2000])
    const back = run([25, 2000], [25, 1050], [75, 1000], [25, 950], [25, 0])
    const kept = dropBypasses([main, back])
    expect(passes(kept, 75, 1000)).toBe(false)
    expect(passes(kept, 25, 1500)).toBe(true)
    expect(passes(kept, 25, 500)).toBe(true)
  })

  it('keeps a one-way pair a block apart as two strands', () => {
    // Out along one street, back along the next one over, 150 m apart for 2 km.
    const main = run([0, 0], [0, 3000])
    const pair = run([0, 2500], [150, 2400], [150, 600], [0, 500])
    expect(dropBypasses([main, pair])).toEqual([main, pair])
  })

  it('keeps an end loop that comes back where it left', () => {
    const main = run([0, 0], [0, 2000])
    const loop = run([0, 2000], [200, 2100], [300, 2000], [200, 1950], [10, 2000])
    expect(dropBypasses([main, loop])).toEqual([main, loop])
  })

  it('keeps a branch that goes somewhere else', () => {
    const main = run([0, 0], [0, 2000])
    const branch = run([0, 1000], [800, 1000], [800, 1800])
    expect(dropBypasses([main, branch])).toEqual([main, branch])
  })
})

describe('dropRetraces', () => {
  const at = (eastM: number, northM: number): LngLat => [LNG + eastM / M_LNG, LAT + northM / M_LAT]
  // North 600 m, but 170 m down a side street and back on the way, the other carriageway 8 m over (9 past Cawang).
  const outAndBack = [...north(0, 300), at(60, 300), at(170, 300), at(170, 308), at(60, 308), ...north(308, 600)]

  it('takes out a bus going down a street and straight back with no halte on it', () => {
    const drawn = dropRetraces(outAndBack)
    expect(Math.max(...drawn.map(p => (p[0] - LNG) * M_LNG))).toBeLessThan(5)
    expect(drawn[0]).toEqual(outAndBack[0])
    expect(drawn[drawn.length - 1]).toEqual(outAndBack[outAndBack.length - 1])
  })

  it('keeps one with a halte the line calls at on it, and a loop round a block', () => {
    expect(dropRetraces(outAndBack, [at(120, 300)])).toEqual(outAndBack)
    // A terminus loop: up the street, round a block and back down it.
    const block = [...north(0, 300), at(80, 300), at(80, 380), at(0, 380), ...north(300, 0)]
    expect(dropRetraces(block)).toEqual(block)
  })
})

describe('smoothPath', () => {
  const metres = (p: LngLat): [number, number] => [(p[0] - LNG) * M_LNG, (p[1] - LAT) * M_LAT]

  it('leaves a straight straight, its ends where they were', () => {
    const smooth = smoothPath(north(0, 500), 6).map(metres)
    for (const [x] of smooth) expect(Math.abs(x)).toBeLessThan(0.01)
    expect(smooth[0]![1]).toBeCloseTo(0, 6)
    expect(smooth[smooth.length - 1]![1]).toBeCloseTo(500, 6)
  })

  it('irons out a wobble of a few metres along a street', () => {
    // A busway as the tiles draw it round a bend: points every 10 m, each 1.5 m off either way.
    const wobbly: LngLat[] = []
    for (let m = 0; m <= 300; m += 10) wobbly.push([LNG + (m % 20 === 0 ? 1.5 : -1.5) / M_LNG, LAT + m / M_LAT])
    const smooth = smoothPath(wobbly, 6).map(metres)
    const inner = smooth.filter(([, y]) => y > 30 && y < 270)
    expect(Math.max(...inner.map(([x]) => Math.abs(x)))).toBeLessThan(0.3)
  })
})

describe('simplifyBends', () => {
  const metres = (p: LngLat): [number, number] => [(p[0] - LNG) * M_LNG, (p[1] - LAT) * M_LAT]
  const at = (x: number, y: number): LngLat => [LNG + x / M_LNG, LAT + y / M_LAT]

  it('keeps a hairpin a curve, not chords', () => {
    // A 12 m radius half turn, as smoothPath leaves 2's by Gambir 2: a point every half metre.
    const hairpin: LngLat[] = []
    for (let k = 0; k <= 75; k++) hairpin.push(at(12 * Math.cos((Math.PI * k) / 75), 12 * Math.sin((Math.PI * k) / 75)))
    const kept = simplifyBends(hairpin, 0.6, 0.1, 4).map(metres)
    const turns = kept.slice(1, -1).map(([x, y], i) => {
      const [ax, ay] = kept[i]!
      const [bx, by] = kept[i + 2]!
      return Math.abs(Math.atan2(x - ax, y - ay) - Math.atan2(bx - x, by - y)) * 180 / Math.PI
    })
    expect(Math.max(...turns.map(t => Math.min(t, 360 - t)))).toBeLessThan(16)
    expect(kept[0]).toEqual(metres(hairpin[0]!))
    expect(kept[kept.length - 1]).toEqual(metres(hairpin[hairpin.length - 1]!))
  })

  it('still flattens the flutter on a straight', () => {
    const flutter: LngLat[] = []
    for (let y = 0; y <= 200; y += 2) flutter.push(at(0.3 * Math.sin(y / 15), y))
    expect(simplifyBends(flutter, 0.6, 0.1, 4)).toHaveLength(2)
  })
})
