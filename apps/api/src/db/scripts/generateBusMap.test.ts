import { describe, expect, it } from 'vitest'
import { decodePolyline, type LngLat } from '../../utils/polyline'
import { dedupePatterns, feedShapes, lengthM, parseRailCoords, railLines, railMajor, railNumbers, railPieces, sampleAlong } from './generateBusMap'

/*
 * Synthetic streets near Monas. Metres to degrees at -6.2: one degree of
 * latitude is 110,574 m and one of longitude ~110,670 m, so 0.001 degree is
 * ~110 m either way.
 */
const LAT = -6.18
const LNG = 106.82
const east = (fromM: number, toM: number, northM = 0): LngLat[] => {
  const pts: LngLat[] = []
  for (let m = fromM; m <= toM; m += 100) pts.push([LNG + m / 110_670, LAT + northM / 110_574])
  return pts
}

describe('sampleAlong', () => {
  it('samples every step and keeps both ends', () => {
    const samples = sampleAlong(east(0, 1000), 100)
    expect(samples.length).toBe(11)
  })
})

describe('dedupePatterns', () => {
  it('draws a short turn of the trunk not at all', () => {
    const trunk = east(0, 5000)
    const shortTurn = east(1000, 3000)
    const pieces = dedupePatterns([shortTurn, trunk])
    expect(pieces).toHaveLength(1)
    expect(lengthM(pieces[0]!)).toBeCloseTo(5000, -2)
  })

  it('draws a branch as just the branch, joined to the trunk', () => {
    const trunk = east(0, 5000)
    // Shares 0..2000 with the trunk, then turns 1 km north.
    const branch: LngLat[] = [...east(0, 2000), [LNG + 2000 / 110_670, LAT + 1000 / 110_574]]
    const pieces = dedupePatterns([trunk, branch])
    expect(pieces).toHaveLength(2)
    // The branch piece starts on the trunk (the covered vertex it leaves from)
    // and is about 1 km long, not 3.
    expect(lengthM(pieces[1]!)).toBeLessThan(1300)
    expect(pieces[1]![pieces[1]!.length - 1]).toEqual(branch[branch.length - 1])
  })

  it('drops the other carriageway of the same road', () => {
    const outbound = east(0, 5000)
    const inbound = east(0, 4000, 40)
    expect(dedupePatterns([outbound, inbound])).toHaveLength(1)
  })

  it('keeps both sides of a road split by a toll road between them', () => {
    // 40 m apart, a toll road down the middle 20 m north (Yos Sudarso under the Tanjung Priok toll).
    const outbound = east(0, 5000)
    const inbound = east(0, 4000, 40)
    const tollY = LAT * 110_574 + 20
    const apart = (a: [number, number], b: [number, number]): boolean => (a[1] - tollY) * (b[1] - tollY) < 0
    expect(dedupePatterns([outbound, inbound], apart)).toHaveLength(2)
  })

  it('keeps a one-way pair a block apart', () => {
    const outbound = east(0, 5000)
    const inbound = east(0, 4000, 250)
    expect(dedupePatterns([outbound, inbound])).toHaveLength(2)
  })
})

describe('parseRailCoords', () => {
  it('skips the header, comments, blank rows and TJ, as [id, lng, lat]', () => {
    const csv = [
      'id,lat,lng',
      '# a comment, with commas',
      'KCI-MRI,-6.2099,106.8502',
      'LRTJ-PRM,,',
      'TJ-H00001P,-6.1,106.8',
      ''
    ].join('\n')
    expect(parseRailCoords(csv)).toEqual([['KCI-MRI', 106.8502, -6.2099]])
  })
})

describe('railNumbers', () => {
  it('numbers a station once per line, in the lines\' order, TJ left out', () => {
    const numbers = railNumbers([
      { operator: 'KCI', lineCode: 'C', path: [{ station: 'SUD', pos: 'C12' }, { station: 'MRI', pos: 'C13' }] },
      { operator: 'KCI', lineCode: 'B', path: [{ station: 'MRI', pos: 'B13' }], branches: [{ fromStation: 'MRI', path: [{ station: 'MRI', pos: 'B99' }] }] },
      { operator: 'TJ', lineCode: '1', path: [{ station: 'H1', pos: '1-1' }] }
    ])
    expect(numbers.get('KCI-SUD')).toEqual([['KCI:C', 'C12']])
    expect(numbers.get('KCI-MRI')).toEqual([['KCI:C', 'C13'], ['KCI:B', 'B13']])
    expect(numbers.has('TJ-H1')).toBe(false)
  })
})

describe('railPieces', () => {
  const seg = (from: string, to: string, ...coords: [number, number][]): { from: string, to: string, lines: string[], coords: [number, number][] } =>
    ({ from, to, lines: ['C'], coords })
  it('chains a line\'s segments into one piece, turning one traced the other way, and breaks at a gap', () => {
    const line = {
      operator: 'KCI' as const,
      lineCode: 'C',
      path: [{ station: 'A', pos: 'C1' }, { station: 'B', pos: 'C2' }, { station: 'C', pos: 'C3' }, { station: 'D', pos: 'C4' }, { station: 'E', pos: 'C5' }]
    }
    const segments = [
      seg('KCI-A', 'KCI-B', [0, 0], [1, 0]),
      seg('KCI-C', 'KCI-B', [2, 0], [1.5, 0.5], [1, 0]),
      seg('KCI-D', 'KCI-E', [3, 0], [4, 0])
    ]
    expect(railPieces(line, segments)).toEqual([
      [[0, 0], [1, 0], [1.5, 0.5], [2, 0]],
      [[3, 0], [4, 0]]
    ])
  })

  it('makes a rail line its line key, its operator\'s name and colour, no stops, TJ left out', () => {
    const lines = railLines([
      { operator: 'KCI', lineCode: 'C', path: [{ station: 'A', pos: 'C1' }, { station: 'B', pos: 'C2' }] },
      { operator: 'TJ', lineCode: '1', path: [{ station: 'H1', pos: '1-1' }, { station: 'H2', pos: '1-2' }] }
    ], [seg('KCI-A', 'KCI-B', [106.8, -6.2], [106.81, -6.2])])
    expect(lines.map(l => [l.code, l.kind, l.name, l.color, l.stops.length, l.shapes.length])).toEqual([['KCI:C', 'RAIL', 'Lin Cikarang', '#25B8EB', 0, 1]])
  })
})

describe('railMajor', () => {
  it('keeps interchanges and line ends, a looping branch\'s end and an unbuilt end not', () => {
    const major = railMajor([
      {
        operator: 'KCI',
        lineCode: 'C',
        path: [{ station: 'A', pos: 'C1' }, { station: 'B', pos: 'C2' }, { station: 'C', pos: 'C3' }, { station: 'X', pos: 'C4', unbuilt: true }],
        branches: [
          { fromStation: 'B', path: [{ station: 'D', pos: 'C5' }] },
          { fromStation: 'B', path: [{ station: 'E', pos: 'C6' }], closeTo: 'B' }
        ]
      },
      { operator: 'KCI', lineCode: 'B', path: [{ station: 'F', pos: 'B1' }, { station: 'B', pos: 'B2' }, { station: 'G', pos: 'B3' }] }
    ])
    expect([...major].sort()).toEqual(['KCI-A', 'KCI-B', 'KCI-C', 'KCI-D', 'KCI-F', 'KCI-G'])
  })
})

describe('feedShapes', () => {
  it('keeps each shape the trips use once, whole, in the order first met', () => {
    const a = east(0, 500)
    const b = east(0, 300, 200)
    const shapes = new Map<string, LngLat[]>([['a', a], ['b', b], ['dot', [a[0]!]]])
    const out = feedShapes(['b', 'a', 'b', 'missing', 'dot', 'a'], shapes)
    expect(out.map(s => decodePolyline(s).length)).toEqual([b.length, a.length])
    expect(decodePolyline(out[1]!)[0]![0]).toBeCloseTo(a[0]![0], 5)
  })
})
