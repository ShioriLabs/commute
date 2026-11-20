import { describe, expect, it } from 'vitest'
import type { LngLat } from '../../utils/polyline'
import { Roads, snapToRoads } from './busMapRoads'

/* Metres to the generator's flat plane and back, as busMapRoads.ts projects. */
const KX = Math.cos((-6.2 * Math.PI) / 180) * 111_320
const KY = 110_574
const X0 = 106.82 * KX
const Y0 = -6.18 * KY
const xy = (east: number, north: number): [number, number] => [X0 + east, Y0 + north]
const at = (east: number, north: number): LngLat => [(X0 + east) / KX, (Y0 + north) / KY]
const east = ([lng]: LngLat): number => lng * KX - X0

const road = (points: [number, number][], { oneway = false, busway = false, bridge = false } = {}) =>
  ({ xy: points.map(([e, n]) => xy(e, n)), oneway, busway, bridge })

describe('snapToRoads', () => {
  it('lays a loose line onto its road', () => {
    const roads = new Roads([road([[0, 0], [0, 1000]])])
    // The feed's points wander 8-12 m off the road.
    const loose = [at(10, 0), at(-8, 250), at(12, 500), at(-9, 750), at(10, 1000)]
    const snapped = snapToRoads(loose, roads)
    for (const p of snapped) expect(Math.abs(east(p))).toBeLessThan(0.5)
  })

  it('follows the road round a corner the feed cut', () => {
    const roads = new Roads([road([[0, 0], [0, 500], [500, 500]])])
    const cut = [at(0, 0), at(0, 470), at(30, 500), at(500, 500)]
    const snapped = snapToRoads(cut, roads)
    expect(snapped.some(p => Math.abs(east(p)) < 0.5 && Math.abs(p[1] * KY - Y0 - 500) < 0.5)).toBe(true)
  })

  it('takes the carriageway of a divided road that runs the way the bus does', () => {
    // Northbound carriageway 15 m east, southbound 15 m west; the line drawn northward, nearer the west.
    const roads = new Roads([
      road([[15, 0], [15, 1000]], { oneway: true }),
      road([[-15, 1000], [-15, 0]], { oneway: true })
    ])
    const snapped = snapToRoads([at(-5, 0), at(-5, 1000)], roads)
    for (const p of snapped) expect(east(p)).toBeCloseTo(15, 0)
  })

  it('keeps a BRT line on the busway beside the general lanes', () => {
    const roads = new Roads([road([[0, 0], [0, 1000]], { busway: true }), road([[12, 0], [12, 1000]])])
    const snapped = snapToRoads([at(8, 0), at(8, 1000)], roads, { brt: true })
    for (const p of snapped) expect(Math.abs(east(p))).toBeLessThan(0.5)
  })

  it('leaves a point with no road near it where the feed put it', () => {
    const roads = new Roads([road([[0, 0], [0, 100]])])
    const far = [at(500, 0), at(500, 200)]
    const snapped = snapToRoads(far, roads)
    expect(east(snapped[0]!)).toBeCloseTo(500, 0)
  })
})

describe('snapToRoads on a roundabout', () => {
  it('goes the short way round a ring across where it is drawn from, not all the way round', () => {
    // A ring 60 m across, drawn anticlockwise from its east point: the seam is at the east.
    const ring: [number, number][] = Array.from({ length: 25 }, (_, k) => {
      const a = (k * 15 * Math.PI) / 180
      return [60 * Math.cos(a), 60 * Math.sin(a)] as [number, number]
    })
    const roads = new Roads([road(ring, { oneway: true }), road([[60, 60], [60, 1000]]), road([[60, -60], [60, -1000]])])
    // South past the ring's east side, across the seam.
    const line = [at(60, 500), at(60, 80), at(55, 25), at(60, 0), at(55, -25), at(60, -80), at(60, -500)]
    const snapped = snapToRoads(line, roads, { anyWay: true })
    // Never out on the ring's west side.
    expect(Math.min(...snapped.map(east))).toBeGreaterThan(0)
  })
})
