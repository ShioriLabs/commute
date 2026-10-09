import { describe, expect, it } from 'vitest'
import type { LineTopology } from '../data/topology'
import { cutShape, indexSegments, railShapes, stitch, type Segment } from './generateTrackShapes'

/*
 * A four-stop line A-B-C-D, each segment a two-point trace stored in the
 * direction the tracer happened to write it. B->C is deliberately stored
 * backwards (C to B), as data/geometry does whenever another line listed the
 * pair first.
 */
const segments: Segment[] = [
  { from: 'KCI-A', to: 'KCI-B', coords: [[0, 0], [1, 0]] },
  { from: 'KCI-C', to: 'KCI-B', coords: [[2, 0], [1.5, 0.5], [1, 0]] },
  { from: 'KCI-C', to: 'KCI-D', coords: [[2, 0], [3, 0]] }
]
const index = indexSegments(segments)

const line = (overrides: Partial<LineTopology> = {}): LineTopology => ({
  operator: 'KCI',
  lineCode: 'X',
  path: [
    { station: 'A', pos: 'X1' },
    { station: 'B', pos: 'X2' },
    { station: 'C', pos: 'X3' },
    { station: 'D', pos: 'X4' }
  ],
  ...overrides
})

describe('stitch', () => {
  it('joins segments end to end, flipping one stored the other way, keeping each joint once', () => {
    expect(stitch(index, ['KCI-A', 'KCI-B', 'KCI-C'])).toEqual([[0, 0], [1, 0], [1.5, 0.5], [2, 0]])
  })

  it('returns null rather than a partial shape when a segment is missing', () => {
    expect(stitch(index, ['KCI-A', 'KCI-B', 'KCI-Z'])).toBeNull()
  })
})

describe('railShapes', () => {
  it('emits every hop both ways', () => {
    const { shapes, missing } = railShapes([line()], index)
    expect(missing).toEqual([])
    expect([...shapes.keys()].sort()).toEqual([
      'KCI-A>KCI-B', 'KCI-B>KCI-A', 'KCI-B>KCI-C', 'KCI-C>KCI-B', 'KCI-C>KCI-D', 'KCI-D>KCI-C'
    ])
    expect(shapes.get('KCI-C>KCI-B')).toEqual([[2, 0], [1.5, 0.5], [1, 0]])
  })

  it('stitches a hop past a pass-through stop from every segment it covers', () => {
    const path = line().path.map(s => (s.station === 'C' ? { ...s, passThrough: true } : s))
    const { shapes } = railShapes([line({ path })], index)
    expect(shapes.get('KCI-B>KCI-D')).toEqual([[1, 0], [1.5, 0.5], [2, 0], [3, 0]])
    expect(shapes.has('KCI-B>KCI-C')).toBe(false)
  })

  it('gives a one-way stop its own direction only, and bridges the other past it', () => {
    // B is served going A->D only: forward runs A>B>C, the reverse C>A runs past it.
    const path = line().path.map(s => (s.station === 'B' ? { ...s, serves: 'forward' as const } : s))
    const { shapes } = railShapes([line({ path })], index)
    expect(shapes.has('KCI-A>KCI-B')).toBe(true)
    expect(shapes.has('KCI-B>KCI-C')).toBe(true)
    expect(shapes.has('KCI-B>KCI-A')).toBe(false)
    expect(shapes.get('KCI-C>KCI-A')).toEqual([[2, 0], [1.5, 0.5], [1, 0], [0, 0]])
  })

  it('reports a hop with a missing segment instead of emitting it', () => {
    const path = [...line().path, { station: 'E', pos: 'X5' }]
    const { shapes, missing } = railShapes([line({ path })], index)
    expect(missing).toEqual(['X KCI-D>KCI-E', 'X KCI-E>KCI-D'])
    expect(shapes.has('KCI-D>KCI-E')).toBe(false)
  })
})

describe('cutShape', () => {
  const shape = [
    { lng: 0, lat: 0, dist: 0 },
    { lng: 1, lat: 0, dist: 100 },
    { lng: 1, lat: 1, dist: 200 }
  ]

  it('cuts between two distances, interpolating both ends', () => {
    expect(cutShape(shape, 50, 150)).toEqual([[0.5, 0], [1, 0], [1, 0.5]])
  })

  it('refuses an empty or reversed range, or one off the shape', () => {
    expect(cutShape(shape, 100, 100)).toBeNull()
    expect(cutShape(shape, 150, 50)).toBeNull()
    expect(cutShape(shape, 50, 250)).toBeNull()
  })
})
