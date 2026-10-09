import { describe, expect, it } from 'vitest'
import { decodePolyline, encodePolyline, simplify, type LngLat } from 'utils/polyline'

describe('encodePolyline', () => {
  it('matches the example in Google\'s format spec', () => {
    const coords: LngLat[] = [[-120.2, 38.5], [-120.95, 40.7], [-126.453, 43.252]]
    expect(encodePolyline(coords)).toBe('_p~iF~ps|U_ulLnnqC_mqNvxq`@')
  })

  it('round-trips at 1e-5 degrees', () => {
    const coords: LngLat[] = [[106.84981, -6.21], [106.85212, -6.21503], [106.79043, -6.59561]]
    expect(decodePolyline(encodePolyline(coords))).toEqual(coords)
  })

  it('encodes an empty line as an empty string', () => {
    expect(encodePolyline([])).toBe('')
    expect(decodePolyline('')).toEqual([])
  })
})

describe('simplify', () => {
  it('drops points within the tolerance and keeps both ends', () => {
    // ~1 m of wobble along a 1 km straight run.
    const line: LngLat[] = [[106.8, -6.2], [106.803, -6.20001], [106.806, -6.2], [106.809, -6.2]]
    expect(simplify(line, 3)).toEqual([[106.8, -6.2], [106.809, -6.2]])
  })

  it('keeps a bend larger than the tolerance', () => {
    const line: LngLat[] = [[106.8, -6.2], [106.805, -6.21], [106.81, -6.2]]
    expect(simplify(line, 3)).toEqual(line)
  })
})
