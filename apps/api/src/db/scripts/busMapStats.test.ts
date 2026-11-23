import { describe, expect, it } from 'vitest'
import { encodePolyline, type LngLat } from '../../utils/polyline'
import type { BusMapEdge } from './busMapBundle'
import { networkScore, type ScoreLine } from './busMapStats'

/* Streets near Monas, in metres east and north of a point: 0.001 degree is ~110 m either way. */
const LAT = -6.18
const LNG = 106.82
const M_LNG = 110_670
const M_LAT = 110_574
const at = (x: number, y: number): LngLat => [LNG + x / M_LNG, LAT + y / M_LAT]
const shape = (...pts: [number, number][]): string => encodePolyline(pts.map(([x, y]) => at(x, y)))

const line = (code: string, color: string, ...pieces: [number, number][][]): ScoreLine =>
  ({ code, color, shapes: pieces.map(p => encodePolyline(p.map(([x, y]) => at(x, y)))) })

describe('networkScore', () => {
  it('charges a line its step across where another joins it, a straight line in full', () => {
    // A east 600 m, alone then with B joining at 300 m on its right: A steps half a width left.
    const edges: BusMapEdge[] = [
      { shape: shape([0, 0], [300, 0]), lines: ['A'] },
      { shape: shape([300, 0], [600, 0]), lines: ['A', 'B'] },
      { shape: shape([300, -300], [300, 0]), lines: ['B'] }
    ]
    const score = networkScore({ edges, lines: [line('A', '#111111', [[0, 0], [600, 0]]), line('B', '#222222', [[300, -300], [300, 0], [600, 0]])] })
    expect(score.lines.A!.moved).toBeCloseTo(0.5, 5)
    expect(score.lines.A!.jog).toBeCloseTo(0.5, 5)
    expect(score.sameCrossings).toBe(0)
  })

  it('weighs a step on a bendy line less: it hides among the bends', () => {
    // The same step, A winding through the node rather than straight on.
    const edges: BusMapEdge[] = [
      { shape: shape([0, 0], [300, 0]), lines: ['A'] },
      { shape: shape([300, 0], [600, 0]), lines: ['A', 'B'] },
      { shape: shape([300, -300], [300, 0]), lines: ['B'] }
    ]
    const zigzag: [number, number][] = [[0, 0], [60, 80], [120, 0], [180, 80], [240, 0], [300, 0], [360, 80], [420, 0], [480, 80], [540, 0], [600, 0]]
    const score = networkScore({ edges, lines: [line('A', '#111111', zigzag), line('B', '#222222', [[300, -300], [300, 0], [600, 0]])] })
    expect(score.lines.A!.moved).toBeCloseTo(0.5, 5)
    expect(score.lines.A!.jog).toBeCloseTo(0.5 * 0.25, 5)
  })

  it('counts two lines going on together in swapped order as a crossing', () => {
    const edges: BusMapEdge[] = [
      { shape: shape([0, 0], [300, 0]), lines: ['A', 'B'] },
      { shape: shape([300, 0], [600, 0]), lines: ['B', 'A'] }
    ]
    const score = networkScore({ edges, lines: [line('A', '#111111', [[0, 0], [600, 0]]), line('B', '#222222', [[0, 0], [600, 0]])] })
    expect(score.sameCrossings).toBe(1)
  })

  it('counts partners parting as a separation: side by side coming in, another between them going on', () => {
    // A and B side by side east; at 300 m C joins from the south between them.
    const edges: BusMapEdge[] = [
      { shape: shape([0, 0], [300, 0]), lines: ['A', 'B'] },
      { shape: shape([300, 0], [600, 0]), lines: ['A', 'C', 'B'] },
      { shape: shape([300, -300], [300, 0]), lines: ['C'] }
    ]
    const lines = [line('A', '#111111', [[0, 0], [600, 0]]), line('B', '#222222', [[0, 0], [600, 0]]), line('C', '#333333', [[300, -300], [300, 0], [600, 0]])]
    expect(networkScore({ edges, lines }).separations).toBe(1)
  })

  it('counts one street drawn twice as overlap, but not a line\'s own two carriageways', () => {
    // Two edges 3 m apart for 400 m, meeting nowhere.
    const twice = (second: string): BusMapEdge[] => [
      { shape: shape([0, 0], [400, 0]), lines: ['A'] },
      { shape: shape([0, 3], [400, 3]), lines: [second] }
    ]
    const lines = [line('A', '#111111', [[0, 0], [400, 0]]), line('B', '#222222', [[0, 3], [400, 3]])]
    const overlap = networkScore({ edges: twice('B'), lines }).overlapM
    expect(overlap).toBeGreaterThan(300)
    expect(overlap).toBeLessThan(400)
    expect(networkScore({ edges: twice('A'), lines }).overlapM).toBe(0)
  })

  it('takes a crossing\'s pieces along one way as one, each line at its own place', () => {
    // A and B swap sides over two 10 m pieces, each stroke drawn alone on the same way.
    const edges: BusMapEdge[] = [
      { shape: shape([0, 0], [300, 0]), lines: ['A', 'B'] },
      { shape: shape([300, 0], [310, 0]), lines: ['A'], shift: 0 },
      { shape: shape([300, 0], [310, 0]), lines: ['B'], shift: 0 },
      { shape: shape([310, 0], [600, 0]), lines: ['B', 'A'] }
    ]
    const score = networkScore({ edges, lines: [line('A', '#111111', [[0, 0], [600, 0]]), line('B', '#222222', [[0, 0], [600, 0]])] })
    // One crossing between them, not a split at every piece.
    expect(score.splitCrossings).toBe(0)
    expect(score.sameCrossings).toBe(1)
  })
})
