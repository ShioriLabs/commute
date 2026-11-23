import { describe, expect, it } from 'vitest'
import type { LngLat } from '../../utils/polyline'
import { koridorOf, koridorsOf, Roads, snapPoint, snapToRoads } from './busMapRoads'

/* Metres to the generator's flat plane and back, as busMapRoads.ts projects. */
const KX = Math.cos((-6.2 * Math.PI) / 180) * 111_320
const KY = 110_574
const X0 = 106.82 * KX
const Y0 = -6.18 * KY
const xy = (east: number, north: number): [number, number] => [X0 + east, Y0 + north]
const at = (east: number, north: number): LngLat => [(X0 + east) / KX, (Y0 + north) / KY]
const east = ([lng]: LngLat): number => lng * KX - X0
const north = ([, lat]: LngLat): number => lat * KY - Y0

const road = (points: [number, number][], { oneway = false, busway = false, bridge = false, motorway = false } = {}) =>
  ({ xy: points.map(([e, n]) => xy(e, n)), oneway, busway, bridge, motorway })

describe('snapPoint', () => {
  // Jl. Galunggung east-west; a side road up to it from the south, its end 10 m short of it.
  const roads = new Roads([road([[-300, 0], [300, 0]]), road([[0, -200], [0, -10]])])

  it('takes the nearest road, whichever way it runs', () => {
    expect(north(snapPoint(at(0, -6), roads))).toBeCloseTo(-10, 0)
  })

  it('keeps a node a koridor bundle goes straight through on its busway, not the carriageway beside it', () => {
    // Rasuna Said by the Setiabudi reservoir: the busway down the middle, a carriageway 12 m east.
    const split = new Roads([road([[0, -300], [0, 300]], { busway: true }), road([[12, -300], [12, 300]])])
    expect(east(snapPoint(at(8, 0), split, [0, 1], true))).toBeCloseTo(0, 0)
    expect(east(snapPoint(at(8, 0), split, [0, 1]))).toBeCloseTo(12, 0)
  })

  it('keeps a node a bundle goes straight through on its street', () => {
    const p = snapPoint(at(0, -6), roads, [1, 0])
    expect(north(p)).toBeCloseTo(0, 0)
    expect(east(p)).toBeCloseTo(0, 0)
  })
})

describe('snapToRoads', () => {
  it('takes the lane past a halte that its bus calls at, by the platform on it', () => {
    // Galunggung: two eastbound busways 12 m apart, the halte between; 6 calls on the south one.
    const roads = new Roads([
      road([[0, 6], [400, 6]], { oneway: true, busway: true }),
      road([[0, -6], [400, -6]], { oneway: true, busway: true })
    ])
    const line = [at(0, 2), at(400, 2)]
    const south = snapToRoads(line, roads, { brt: true, platforms: [at(200, -5)] })
    for (const p of south.filter(q => Math.abs(east(q) - 200) < 40)) expect(north(p)).toBeCloseTo(-6, 0)
    // Platforms on both (one each way, 4 at Pasar Rumput) leave the choice as it was.
    const either = snapToRoads(line, roads, { brt: true, platforms: [at(200, -5), at(210, 5)] })
    expect(either).toEqual(snapToRoads(line, roads, { brt: true }))
  })

  it('keeps the way through a terminal the tiles draw no lanes of, past its halte', () => {
    // Ragunan: the road runs 23 m north of the halte; the buses run through the terminal past it.
    const roads = new Roads([road([[-500, 23], [500, 23]])])
    const inbound = [at(400, 23), at(150, 23), at(100, 0), at(0, 0), at(-60, 0)]
    const laid = snapToRoads(inbound, roads, { stops: [at(0, 0)] })
    expect(laid.some(p => Math.abs(east(p)) < 10 && Math.abs(north(p)) < 3)).toBe(true)
    // A halte off the road along the way, not at an end, is beside a street the tiles leave out.
    const through = [at(-400, 0), at(400, 0)]
    for (const p of snapToRoads(through, roads, { stops: [at(0, 0)] })) expect(north(p)).toBeCloseTo(23, 0)
  })

  it('takes a slip road its street ends partway along, onto the road it ends partway along', () => {
    // 6 at Flyover Kuningan: Purworejo comes south and ends partway along its one-way slip road, which
    // runs up from the corner (-5, 0) and back down onto Latuharhari, ending partway along that, 20 m
    // on from the corner.
    const roads = new Roads([
      road([[0, 200], [0, 30]]),
      road([[-5, 0], [-3, 15], [0, 30], [8, 15], [15, 0]], { oneway: true }),
      road([[-5, 0], [200, 0]], { oneway: true })
    ])
    const laid = snapToRoads([at(0, 200), at(0, 30), at(15, 0), at(200, 0)], roads)
    expect(laid.some(p => east(p) < -2)).toBe(false)
    expect(laid.some(p => Math.abs(east(p) - 8) < 3 && Math.abs(north(p) - 15) < 3)).toBe(true)
  })

  it('takes a koridor up onto its own elevated busway, not another’s', () => {
    // 13 past Velbak: the feed runs nearer the street than its elevated busway, 10 m north.
    const roads = new Roads([
      road([[0, 0], [1000, 0]], { oneway: true }),
      { ...road([[0, 10], [1000, 10]], { busway: true, bridge: true }), koridors: ['13'] }
    ])
    const thirteen = snapToRoads([at(0, 1), at(1000, 1)], roads, { brt: true, koridor: '13' })
    for (const p of thirteen) expect(north(p)).toBeCloseTo(10, 0)
    const one = snapToRoads([at(0, 1), at(1000, 1)], roads, { brt: true, koridor: '1' })
    for (const p of one) expect(north(p)).toBeCloseTo(0, 0)
  })

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

  it('keeps to the street under a toll road, even where the feed runs nearer the toll', () => {
    // 9 on S. Parman under the Tol Dalam Kota: the toll 3 m from the feed, the street 20 m.
    const roads = new Roads([road([[20, 0], [20, 1000]]), road([[3, 0], [3, 1000]], { oneway: true, bridge: true, motorway: true })])
    const snapped = snapToRoads([at(0, 0), at(0, 1000)], roads, { brt: true })
    for (const p of snapped) expect(east(p)).toBeCloseTo(20, 0)
  })

  it('takes a median busway the feed runs 12 m off, along the general lanes', () => {
    // Koridor 1 on Sudirman: the feed's shape follows the carriageway, the busway is in the median.
    const roads = new Roads([road([[0, 0], [0, 1000]]), road([[12, 0], [12, 1000]], { busway: true })])
    const snapped = snapToRoads([at(0, 0), at(0, 1000)], roads, { brt: true })
    for (const p of snapped) expect(east(p)).toBeCloseTo(12, 0)
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

  it('takes the roads round a junction the feed cuts across in one straight', () => {
    // 8 from Tomang Raya (west along y 0) onto S. Parman (north up x 0) by the busway's curve; the
    // feed draws one straight from 150 m along Tomang Raya to 150 m up S. Parman.
    const roads = new Roads([
      road([[600, 0], [100, 0], [60, 10], [30, 40], [10, 60], [0, 100]], { oneway: true, busway: true }),
      road([[0, 100], [0, 600]], { oneway: true })
    ])
    const snapped = snapToRoads([at(600, 0), at(150, 0), at(0, 150), at(0, 600)], roads, { brt: true })
    const near = (e: number, n: number): number => Math.min(...snapped.map(p => Math.hypot(east(p) - e, north(p) - n)))
    expect(near(75, 75)).toBeGreaterThan(40)
    expect(near(30, 40)).toBeLessThan(1)
  })

  it('keeps a way the feed goes off the roads to call at a halte, rather than routing past it', () => {
    // 11D to the Gapura Rusun Pulo Jahe terminus, 40 m off the end of the street the roads have.
    const roads = new Roads([road([[0, 0], [0, 500]], { oneway: true }), road([[0, 500], [0, 1000]], { oneway: true })])
    const halte = at(-40, 500)
    const snapped = snapToRoads([at(0, 0), at(0, 470), halte, at(0, 530), at(0, 1000)], roads, { stops: [halte] })
    expect(Math.min(...snapped.map(p => Math.hypot(east(p) + 40, north(p) - 500)))).toBeLessThan(5)
  })

  it('keeps a way the feed goes far off the roads, rather than routing straight past it', () => {
    // 11D up the spur to Gapura Rusun Pulo Jahe, 150 m off the street, on no road the tiles carry:
    // the street's two ways either side join where the spur leaves, but the bus goes up the spur.
    const roads = new Roads([road([[0, 0], [0, 500]], { oneway: true }), road([[0, 500], [0, 1000]], { oneway: true })])
    const snapped = snapToRoads([at(0, 0), at(0, 470), at(150, 500), at(0, 530), at(0, 1000)], roads)
    expect(Math.max(...snapped.map(east))).toBeGreaterThan(100)
  })
})

describe('koridorsOf', () => {
  it('reads the koridors a busway carries from its name', () => {
    expect(koridorsOf('Transjakarta Busway Koridor 4, 6')).toEqual(['4', '6'])
    expect(koridorsOf('Transjakarta Busway Koridor 13')).toEqual(['13'])
    expect(koridorsOf('Jalan Sudirman')).toEqual([])
  })

  it('puts a line in its koridor family by its number', () => {
    expect(koridorOf('13E')).toBe('13')
    expect(koridorOf('L13E')).toBe('13')
    expect(koridorOf('6A')).toBe('6')
  })
})
