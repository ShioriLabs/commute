import { describe, expect, it } from 'vitest'
import type { LngLat } from '../../utils/polyline'
import { dedupePatterns, lengthM, parseRailCoords, sampleAlong } from './generateBusMap'

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
