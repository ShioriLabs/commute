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

const road = (points: [number, number][], { oneway = false, busway = false, bridge = false, motorway = false } = {}) =>
  ({ xy: points.map(([e, n]) => xy(e, n)), oneway, busway, bridge, motorway })

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

  it('steps across a divided road drawn as one line rather than round its far end', () => {
    // Both carriageways and the roundabout joining them as one road: up 12 m east, round at 1200 m,
    // back down 12 m west. The line crosses from nearer the east one to nearer the west halfway.
    const up = Array.from({ length: 13 }, (_, k) => [12, k * 100] as [number, number])
    const down = Array.from({ length: 13 }, (_, k) => [-12, 1200 - k * 100] as [number, number])
    const roads = new Roads([road([...up, [0, 1220], ...down])])
    const snapped = snapToRoads([at(8, 0), at(8, 480), at(-8, 520), at(-8, 1000)], roads, { anyWay: true })
    const north = (p: LngLat): number => p[1] * KY - Y0
    expect(Math.max(...snapped.map(north))).toBeLessThan(1050)
  })

  it('hands over between roads where the line is, not at a far end of a long straight', () => {
    // A street drawn as one 1.6 km straight, and a short side road the line wanders onto halfway.
    const roads = new Roads([road([[0, -500], [0, 1100]]), road([[20, 280], [20, 320]])])
    const snapped = snapToRoads([at(0, 0), at(0, 270), at(18, 290), at(18, 310), at(0, 330), at(0, 600)], roads)
    const north = (p: LngLat): number => p[1] * KY - Y0
    // Going north all the way, a few metres' wobble aside: never out to the straight's far end and back.
    for (let i = 1; i < snapped.length; i++) expect(north(snapped[i]!)).toBeGreaterThanOrEqual(north(snapped[i - 1]!) - 5)
    expect(Math.max(...snapped.map(north))).toBeLessThan(650)
  })

  it('leaves a point with no road near it where the feed put it', () => {
    const roads = new Roads([road([[0, 0], [0, 100]])])
    const far = [at(500, 0), at(500, 200)]
    const snapped = snapToRoads(far, roads)
    expect(east(snapped[0]!)).toBeCloseTo(500, 0)
  })
})

describe('Roads.motorwayBetween', () => {
  it('parts the two sides of a road split by a toll road alongside, not two points it crosses over', () => {
    // Yos Sudarso at Walikota: carriageways 17 m either side of the toll road, running north.
    const roads = new Roads([road([[0, -500], [0, 500]], { motorway: true }), road([[-500, 300], [500, 300]], { motorway: true })])
    const northward: [number, number] = [0, 1]
    expect(roads.motorwayBetween(xy(-17, 0), xy(17, 0), northward)).toBe(true)
    expect(roads.motorwayBetween(xy(-17, 0), xy(-17, 30), northward)).toBe(false)
    // Along a street the east-west toll road crosses over: the same street either side of it.
    expect(roads.motorwayBetween(xy(100, 290), xy(100, 310), northward)).toBe(false)
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

  it('stays on its road past a few metres the feed wobbles onto a road beside it', () => {
    // 9 southbound at Grogol: two points on a ramp 20 m east, then back on the street it was on.
    const roads = new Roads([
      road([[0, 0], [0, 1000]], { oneway: true }),
      road([[20, 494], [20, 502]], { oneway: true })
    ])
    const line = [at(0, 0), at(0, 470), at(20, 496), at(20, 500), at(0, 526), at(0, 1000)]
    const snapped = snapToRoads(line, roads)
    expect(Math.max(...snapped.map(east))).toBeLessThan(10)
  })
})
