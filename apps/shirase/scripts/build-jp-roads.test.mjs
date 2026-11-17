import ClipperLib from 'clipper-lib'
import { describe, expect, it } from 'vitest'
import { buildTile, cropNear, dashes, encodeBuilt, findJunctions, islandsNear, kerbedIsland, lanePieces, laneRow, loadSpec, medianStretchesFor, offsetPolyline, rowFor, smoothLine, toPath } from './build-jp-roads.mjs'
import { decodeLayer, project, ringArea } from './lib/tiles.mjs'

const { Clipper } = ClipperLib
const spec = loadSpec()
// 1 unit = 1 m keeps the synthetic geometry readable.
const UPM = 1
const feature = (kind_detail, line, extra = {}) => ({ props: { kind_detail, ...extra }, lines: [line] })
const length = line => line.slice(1).reduce((n, p, i) => n + Math.hypot(p[0] - line[i][0], p[1] - line[i][1]), 0)
/** Points every half metre along lines, so long straight segments are checked too. */
const sample = lines => lines.flatMap(l => l.slice(1).flatMap((b, i) => {
  const a = l[i]
  const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.5))
  return Array.from({ length: n + 1 }, (_, k) => [a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n])
}))

describe('rowFor', () => {
  it('sorts tile roads into spec rows', () => {
    expect(rowFor(spec, { kind_detail: 'primary', oneway: 'yes' })?.id).toBe('arterial-oneway')
    expect(rowFor(spec, { kind_detail: 'primary' })?.id).toBe('arterial-twoway')
    expect(rowFor(spec, { kind_detail: 'primary', is_tunnel: true })).toBeNull()
    expect(rowFor(spec, { kind_detail: 'footway' })).toBeNull()
  })

  it('leaves out private service roads but keeps gated streets and access=no busways', () => {
    expect(rowFor(spec, { kind_detail: 'service', access: 'private', name: 'Jalan Gedung' })).toBeNull()
    // Kebayoran's portal-gated streets: private, but real named streets.
    expect(rowFor(spec, { kind_detail: 'residential', access: 'private', name: 'Jalan Lamandau' })?.id).toBe('local')
    expect(rowFor(spec, { kind_detail: 'residential', access: 'destination' })?.id).toBe('local')
    expect(rowFor(spec, { kind_detail: 'busway', access: 'no' })?.id).toBe('busway')
  })

  it('draws a service road only when it is named, leaving out lobby loops and parking aisles', () => {
    expect(rowFor(spec, { kind_detail: 'service', oneway: 'yes' })).toBeNull()
    expect(rowFor(spec, { kind_detail: 'service', name: 'Jalan Martapura' })?.id).toBe('service')
  })

  it('surfaces service roads and living streets without marking them, and ramps with edge lines', () => {
    expect(rowFor(spec, { kind_detail: 'service', name: 'Jalan Martapura' })).toMatchObject({ id: 'service', lines: [] })
    expect(rowFor(spec, { kind_detail: 'living_street' })).toMatchObject({ id: 'living', lines: [] })
    expect(rowFor(spec, { kind_detail: 'primary_link', is_link: true })?.id).toBe('link')
    expect(rowFor(spec, { kind_detail: 'primary_link' })).toBeNull()
    expect(rowFor(spec, { kind_detail: 'primary', is_link: true })).toBeNull()
  })
})

describe('offsetPolyline', () => {
  it('shifts a straight line sideways by the distance', () => {
    expect(offsetPolyline([[0, 0], [10, 0]], 2)).toEqual([[0, 2], [10, 2]])
    expect(offsetPolyline([[0, 0], [10, 0]], -2)).toEqual([[0, -2], [10, -2]])
  })

  it('keeps the distance through a right-angle bend', () => {
    const out = offsetPolyline([[0, 0], [10, 0], [10, 10]], -1)
    expect(out[1][0]).toBeCloseTo(11)
    expect(out[1][1]).toBeCloseTo(-1)
  })
})

describe('toPath', () => {
  // Clipper 6 never returns from an open-path clip containing a repeated
  // point; this hung the first full build on one rural tile for an hour.
  it('drops repeated points that integer rounding creates', () => {
    const path = toPath([[0, 0], [0.001, 0.001], [10, 0], [10, 0], [10.0001, 5]])
    expect(path).toEqual([{ X: 0, Y: 0 }, { X: 160, Y: 0 }, { X: 160, Y: 80 }])
  })
})

describe('smoothLine', () => {
  it('curves a bend through every original vertex', () => {
    const bend = [[0, 0], [10, 0], [18, 4], [24, 10], [28, 18]]
    const out = smoothLine(bend, 1, 60)
    expect(out.length).toBeGreaterThan(bend.length * 3)
    for (const v of bend) expect(out.some(p => Math.hypot(p[0] - v[0], p[1] - v[1]) < 1e-9)).toBe(true)
  })

  it('keeps a sharp corner a corner and a straight road unchanged', () => {
    expect(smoothLine([[0, 0], [10, 0], [10, 10]], 1, 60)).toEqual([[0, 0], [10, 0], [10, 10]])
    expect(smoothLine([[0, 0], [10, 0], [20, 0], [30, 0]], 1, 60)).toEqual([[0, 0], [10, 0], [20, 0], [30, 0]])
  })
})

describe('cropNear', () => {
  it('cuts a long segment at the window even with no vertex inside it', () => {
    expect(cropNear([[0, 0], [1000, 0]], 500, 0, 60)).toEqual([[[440, 0], [560, 0]]])
  })

  it('splits a line that leaves and re-enters the window', () => {
    const parts = cropNear([[0, 0], [100, 0], [100, 300], [0, 300], [0, 10]], 50, 0, 60)
    expect(parts.length).toBe(2)
  })
})

describe('dashes', () => {
  it('cuts true-length dashes from the start of the line', () => {
    expect(dashes([[0, 0], [25, 0]], 5, 5)).toEqual([[[0, 0], [5, 0]], [[10, 0], [15, 0]], [[20, 0], [25, 0]]])
  })

  it('carries a dash round a corner', () => {
    expect(dashes([[0, 0], [3, 0], [3, 9]], 4, 2)).toEqual([[[0, 0], [3, 0], [3, 1]], [[3, 3], [3, 7]]])
  })

  it('never stalls on lengths that do not divide evenly', () => {
    const line = [[0, 0], [1000.3333, 0.1], [2000.7777, 5.5]]
    const out = dashes(line, 6, 9)
    expect(out.length).toBeGreaterThan(130)
    for (const d of out.slice(0, -1)) expect(length(d)).toBeCloseTo(6, 6)
  })
})

describe('findJunctions', () => {
  const road = (line, level = 'g') => ({ level, line })

  it('finds a T whose shared vertex is missing from the main road', () => {
    const js = findJunctions([road([[100, 1000], [3000, 1000]]), road([[1500, 1000], [1500, 2000]])])
    expect(js).toEqual([{ x: 1500, y: 1000, level: 'g', roads: [0, 1], through: [0] }])
  })

  it('ignores a continuation, a bridge over a road, and ends at the clip edge', () => {
    expect(findJunctions([road([[100, 1000], [1500, 1000]]), road([[1500, 1000], [3000, 1000]])])).toEqual([])
    expect(findJunctions([road([[100, 1000], [3000, 1000]], 'b'), road([[1500, 100], [1500, 3000]])])).toEqual([])
    expect(findJunctions([road([[-64, 1000], [-64, 3000]]), road([[-64, 2000], [500, 2000]])])).toEqual([])
  })
})

describe('medianStretchesFor', () => {
  it('gives each tile the stretches that reach it, boxed in its tile units', () => {
    // Rasuna Said's stretch, at the tile holding Karet Kuningan.
    const [fx, fy] = project(106.8317, -6.2215, 15)
    const [x, y] = [Math.floor(fx), Math.floor(fy)]
    const here = medianStretchesFor(spec, x, y)
    expect(here.map(s => s.name)).toContain('Rasuna Said')
    const [x0, y0, x1, y1] = here.find(s => s.name === 'Rasuna Said').rect
    expect(x0).toBeLessThan(x1)
    expect(y0).toBeLessThan(y1)
    // Far away (Bekasi), none.
    const [bx, by] = project(107.0, -6.24, 15)
    expect(medianStretchesFor(spec, Math.floor(bx), Math.floor(by))).toEqual([])
  })
})

describe('laneRow (lanes from raw OSM)', () => {
  it('cuts a one-way road to its lane count: true width, a line between every two lanes', () => {
    const row = laneRow(rowFor(spec, { kind_detail: 'primary', oneway: 'yes' }), { lanes: 4 })
    expect(row.widthM).toBeCloseTo(4 * 3.25 + 1)
    const edge = row.lines.find(l => l.edge)
    expect(edge.offsetM).toBeCloseTo(row.widthM / 2 - 0.5)
    // Lane lines at 0 and ±3.25: three of them for four lanes.
    expect(row.lines.filter(l => !l.edge).map(l => l.offsetM).sort()).toEqual([0, 3.25])
  })

  it('keeps a two-way road\'s centre line and splits each side', () => {
    const base = rowFor(spec, { kind_detail: 'primary' })
    const row = laneRow(base, { lanes: 4 })
    for (const centre of base.lines.filter(l => !l.edge && l.offsetM < 0.5)) expect(row.lines).toContainEqual(centre)
    expect(row.lines.filter(l => !l.edge && l.offsetM >= 0.5).map(l => l.offsetM)).toEqual([3.25])
  })

  it('keeps a motorway\'s own wider shoulder', () => {
    const motorway = rowFor(spec, { kind_detail: 'motorway' })
    const shoulder = motorway.widthM / 2 - motorway.lines.find(l => l.edge).offsetM
    const row = laneRow(motorway, { lanes: 3 })
    expect(row.widthM).toBeCloseTo(3 * 3.25 + 2 * shoulder)
    expect(row.lines.find(l => l.edge).offsetM).toBeCloseTo(row.widthM / 2 - shoulder)
  })

  it('trusts a lane-like OSM width, ignores an odd one, and leaves busways and unmarked rows alone', () => {
    const oneway = rowFor(spec, { kind_detail: 'primary', oneway: 'yes' })
    expect(laneRow(oneway, { lanes: 3, width: 10.5 }).widthM).toBeCloseTo(11.5)
    expect(laneRow(oneway, { lanes: 3, width: 40 }).widthM).toBeCloseTo(3 * 3.25 + 1)
    expect(laneRow(rowFor(spec, { kind_detail: 'busway' }), { lanes: 2 })).toBe(rowFor(spec, { kind_detail: 'busway' }))
    expect(laneRow(rowFor(spec, { kind_detail: 'service', name: 'Jalan X' }), { lanes: 2 }).widthM).toBe(4)
  })
})

describe('lane changes', () => {
  const oneway = rowFor(spec, { kind_detail: 'primary', oneway: 'yes' })
  const line = [[100, 1000], [500, 1000]]
  const runs = [{ from: 0, to: 200, lanes: 2, width: null }, { from: 200, to: 400, lanes: 3, width: null }]

  it('cuts a road where OSM\'s lane count changes, with a taper centred on the change', () => {
    const pieces = lanePieces(oneway, line, runs, UPM)
    expect(pieces.map(p => Boolean(p.taper))).toEqual([false, true, false])
    expect(pieces[1].taper).toEqual([2 * 3.25 + 1, 3 * 3.25 + 1])
    // 30 m, centred on the change at 200 m along (x = 300), overlapping its neighbours by half a metre.
    expect(pieces[1].line[0][0]).toBeCloseTo(284.5)
    expect(pieces[1].line.at(-1)[0]).toBeCloseTo(315.5)
    expect(pieces[0].line.at(-1)[0]).toBeCloseTo(285.5)
    expect(pieces[2].line[0][0]).toBeCloseTo(314.5)
    // Square where pieces meet, round only at the road's own ends.
    expect(pieces.map(p => [p.buttStart, p.buttEnd])).toEqual([[false, true], [true, true], [true, false]])
  })

  it('paves a lane change with no holes whichever way the road was drawn, and no junction at its joints', () => {
    for (const drawn of [line, [...line].reverse()]) {
      const { surfaces, paint } = buildTile(spec, [feature('primary', drawn, { oneway: 'yes' })], UPM, { lanesFor: () => runs })
      const asphalt = surfaces.find(s => s.paving === 'asphalt').polygons
      expect(asphalt.length).toBe(1)
      // An outer ring and no holes (a reversed taper cancelled its neighbours).
      expect(asphalt[0].length).toBe(1)
      // The lane line between the first two lanes runs on through both joints
      // (a joint read as a junction cut it there): paint near x = 285 and 315.
      const lines = sample(paint.filter(p => p.kind === 'mark').flatMap(p => p.lines))
      expect(lines.some(([x]) => Math.abs(x - 280) < 2)).toBe(true)
      expect(lines.some(([x]) => Math.abs(x - 320) < 2)).toBe(true)
    }
  })

  it('paves the change as one smooth surface, widening across the taper', () => {
    const { surfaces } = buildTile(spec, [feature('primary', line, { oneway: 'yes' })], UPM, { lanesFor: () => runs })
    const asphalt = surfaces.find(s => s.paving === 'asphalt').polygons
    expect(asphalt.length).toBe(1)
    const inside = ([px, py]) => {
      let hit = false
      const ring = asphalt[0][0]
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i]
        const [xj, yj] = ring[j]
        if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) hit = !hit
      }
      return hit
    }
    // Scanned outward from the centreline in 5 cm steps.
    const halfWidthAt = (x) => {
      let h = 0
      while (inside([x, 1000 + h + 0.05])) h += 0.05
      return h
    }
    expect(Math.abs(halfWidthAt(200) - 3.75)).toBeLessThan(0.1)
    expect(Math.abs(halfWidthAt(400) - 5.375)).toBeLessThan(0.1)
    expect(halfWidthAt(300)).toBeGreaterThan(3.9)
    expect(halfWidthAt(300)).toBeLessThan(5.2)
  })
})

describe('buildTile', () => {
  it('rounds the inside corners of a T like a kerb, and leaves a narrow median open', () => {
    const area = polys => polys.reduce((n, poly) => n + Math.abs(poly[0].slice(1).reduce((s, p, i) => s + poly[0][i][0] * p[1] - p[0] * poly[0][i][1], 0)) / 2, 0)
    const t = buildTile(spec, [
      feature('tertiary', [[100, 1000], [3000, 1000]]),
      feature('tertiary', [[1500, 1000], [1500, 2000]])
    ], UPM).surfaces.find(s => s.paving === 'asphalt')
    // Plain union of the two 7 m roads (2900 + 1000 long, overlap 7 x 3.5) plus
    // round ends, versus the same with two 5 m kerb fillets (each ~5.4 m²).
    const plain = 2900 * 7 + 1000 * 7 - 7 * 3.5 + Math.PI * 3.5 ** 2 * 1.5
    expect(area(t.polygons)).toBeGreaterThan(plain + 8)
    // Two parallel one-way roads 8 m apart (a 1 m median) never meet: no fill.
    const pair = buildTile(spec, [
      feature('tertiary', [[100, 1000], [3000, 1000]], { oneway: 'yes' }),
      feature('tertiary', [[100, 1008], [3000, 1008]], { oneway: 'yes' })
    ], UPM).surfaces.find(s => s.paving === 'asphalt')
    expect(pair.polygons.length).toBe(2)
  })

  it('merges the surfaces of a T into one shape', () => {
    const { surfaces } = buildTile(spec, [
      feature('tertiary', [[100, 1000], [3000, 1000]]),
      feature('residential', [[1500, 1000], [1500, 2000]])
    ], UPM)
    const asphalt = surfaces.filter(s => s.level === 'g' && s.paving === 'asphalt')
    expect(asphalt.length).toBe(1)
    expect(asphalt[0].polygons.length).toBe(1)
  })

  it('runs the edge line round the kerb returns of a T and never across its mouth', () => {
    const { paint } = buildTile(spec, [
      feature('tertiary', [[100, 1000], [3000, 1000]]),
      feature('residential', [[1500, 1000], [1500, 2000]])
    ], UPM)
    const edge = sample(paint.filter(p => p.colour === 'white' && p.width === 0.15).flatMap(p => p.lines))
    // Along the main road on the side street's side, 0.5 m in from the 3.5 m edge...
    expect(edge.some(([x, y]) => Math.abs(x - 1300) < 0.3 && Math.abs(y - 1003) < 0.1)).toBe(true)
    // ...but nothing across the side street's 5 m mouth.
    expect(edge.some(([x, y]) => x > 1498 && x < 1502 && y > 1002 && y < 1004)).toBe(false)
    // And it turns the corner: there is edge line in the kerb return's quarter.
    expect(edge.some(([x, y]) => x > 1502.5 && x < 1508 && y > 1003.2 && y < 1008)).toBe(true)
  })

  it('outlines the asphalt as kerbs, round the kerb returns, never along the tile edge', () => {
    const { paint } = buildTile(spec, [
      feature('tertiary', [[-200, 1000], [4300, 1000]]),
      feature('residential', [[1500, 1000], [1500, 2000]])
    ], UPM)
    expect(paint.every(p => ['kerb', 'edge', 'mark'].includes(p.kind))).toBe(true)
    const kerb = sample(paint.filter(p => p.kind === 'kerb').flatMap(p => p.lines))
    // On the main road's kerb (3.5 m off its centreline)...
    expect(kerb.some(([x, y]) => Math.abs(x - 1300) < 0.3 && Math.abs(y - 1003.5) < 0.1)).toBe(true)
    // ...turning the corner through the kerb return's quarter...
    expect(kerb.some(([x, y]) => x > 1503 && x < 1507 && y > 1004 && y < 1007.5)).toBe(true)
    // ...and never across the side street's mouth.
    expect(kerb.some(([x, y]) => x > 1498 && x < 1502 && y > 1002 && y < 1004)).toBe(false)
    // The road runs off both tile edges; the tile's clip edge is not a kerb.
    expect(kerb.some(([x, y]) => (Math.abs(x + 32) < 0.5 || Math.abs(x - 4128) < 0.5) && Math.abs(y - 1000) < 3)).toBe(false)
  })

  it('marks a road with no junction in its tile', () => {
    // Clipper's difference against no junction zones returned no open paths,
    // dropping centre and lane lines on such stretches.
    const { paint } = buildTile(spec, [feature('tertiary', [[100, 1000], [3000, 1000]])], UPM)
    const centre = sample(paint.filter(p => p.kind === 'mark').flatMap(p => p.lines))
    expect(centre.filter(([, y]) => Math.abs(y - 1000) < 0.1).length).toBeGreaterThan(2000)
  })

  it('paves a mapped sidewalk out to the kerb, and a far one as just its strip', () => {
    const inside = (polys, [px, py]) => polys.some(poly => poly.some((ring, r) => {
      let hit = false
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i]
        const [xj, yj] = ring[j]
        if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) hit = !hit
      }
      return r === 0 && hit
    }))
    const { surfaces } = buildTile(spec, [
      feature('tertiary', [[100, 1000], [3000, 1000]]),
      // 5.5 m beyond the 3.5 m kerb: a mapped sidewalk off our guessed width.
      feature('sidewalk', [[200, 1009], [2900, 1009]]),
      // 30 m off: no kerb within reach.
      feature('sidewalk', [[200, 1060], [2900, 1060]]),
      // A pedestrian street, 6 m wide.
      feature('pedestrian', [[1500, 1200], [1500, 1400]])
    ], UPM)
    const pave = surfaces.find(s => s.paving === 'sidewalk').polygons
    // From the kerb to a metre past the sidewalk line...
    for (const y of [1004, 1007, 1009.8]) expect(inside(pave, [1500, y]), `y ${y}`).toBe(true)
    // ...never over the road, nor beyond the strip.
    expect(inside(pave, [1500, 1002])).toBe(false)
    expect(inside(pave, [1500, 1011])).toBe(false)
    // The far one: its 2 m strip and nothing towards the road.
    expect(inside(pave, [1500, 1060])).toBe(true)
    expect(inside(pave, [1500, 1050])).toBe(false)
    expect(inside(pave, [1502.5, 1300])).toBe(true)
    expect(inside(pave, [1504, 1300])).toBe(false)
  })

  it('ends a T\'s stem square, so it never pokes past a narrow main road\'s far kerb', () => {
    // A one-lane main road (OSM lanes=1: 3.25 + 1 m) and a 5 m side street ending on it.
    const runs = [{ from: 0, to: 2000, lanes: 1, width: null }]
    const { surfaces } = buildTile(spec, [
      feature('tertiary', [[100, 1000], [2100, 1000]], { oneway: 'yes' }),
      feature('residential', [[1500, 900], [1500, 1000]])
    ], UPM, { lanesFor: (line, kind) => (kind === 'tertiary' ? runs : null) })
    const asphalt = surfaces.find(s => s.paving === 'asphalt').polygons
    const farKerb = 1000 + (3.25 + 1) / 2
    const below = asphalt.flatMap(poly => poly[0]).filter(([x, y]) => Math.abs(x - 1500) < 4 && y > farKerb + 0.2)
    expect(below).toEqual([])
  })

  it('reads a road through a junction where every road ends, and ends the stem square (Kendal / Latuharhari)', () => {
    // Two one-lane streets of different names meet end to end; a wider street starts there too.
    const oneLane = [{ from: 0, to: 1400, lanes: 1, width: null }]
    const { surfaces } = buildTile(spec, [
      feature('tertiary', [[100, 1000], [1500, 1000]], { oneway: 'yes', name: 'Kendal' }),
      feature('tertiary', [[1500, 1000], [2900, 1000]], { oneway: 'yes', name: 'Latuharhari' }),
      feature('tertiary', [[1500, 1000], [1500, 900]], { oneway: 'yes', name: 'Purworejo' })
    ], UPM, { lanesFor: line => (line[0][1] === line[1][1] ? oneLane : null) })
    const asphalt = surfaces.find(s => s.paving === 'asphalt').polygons
    const farKerb = 1000 + (3.25 + 1) / 2
    expect(asphalt.flatMap(poly => poly[0]).filter(([x, y]) => Math.abs(x - 1500) < 5 && y > farKerb + 0.2)).toEqual([])
  })

  it('tapers a ground road onto a wider bridge instead of stepping at the abutment', () => {
    const { surfaces } = buildTile(spec, [
      feature('tertiary', [[100, 1000], [1000, 1000]]),
      feature('primary', [[1000, 1000], [1200, 1000]], { is_bridge: true })
    ], UPM)
    const ground = surfaces.find(s => s.level === 'g' && s.paving === 'asphalt').polygons
    const inside = ([px, py]) => ground.some((poly) => {
      let hit = false
      const ring = poly[0]
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i]
        const [xj, yj] = ring[j]
        if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) hit = !hit
      }
      return hit
    })
    const halfWidthAt = (x) => {
      let h = 0
      while (inside([x, 1000 + h + 0.05])) h += 0.05
      return h
    }
    // Its own 7 m well before the bridge, the bridge's 14 m at the abutment, in between across the taper.
    expect(Math.abs(halfWidthAt(900) - 3.5)).toBeLessThan(0.1)
    expect(Math.abs(halfWidthAt(999) - 7)).toBeLessThan(0.4)
    expect(halfWidthAt(985)).toBeGreaterThan(4)
    expect(halfWidthAt(985)).toBeLessThan(6.5)
  })

  it('tapers a road at both ends when it meets wider bridges at both', () => {
    const { surfaces } = buildTile(spec, [
      feature('primary', [[100, 1000], [500, 1000]], { is_bridge: true }),
      feature('tertiary', [[500, 1000], [700, 1000]]),
      feature('primary', [[700, 1000], [1100, 1000]], { is_bridge: true })
    ], UPM)
    const ground = surfaces.find(s => s.level === 'g' && s.paving === 'asphalt').polygons
    const ys = x => ground.flatMap(poly => poly[0]).filter(([px]) => Math.abs(px - x) < 1.5).map(([, py]) => py)
    // Bridge-wide (14 m) at both joins, its own 7 m in the middle.
    expect(Math.max(...ys(501)) - 1000).toBeGreaterThan(6)
    expect(Math.max(...ys(699)) - 1000).toBeGreaterThan(6)
  })

  it('fades bus paving to a point where a busway ends into traffic, but not where it carries on', () => {
    const { surfaces } = buildTile(spec, [
      feature('busway', [[100, 1000], [600, 1000]]),
      feature('busway', [[600, 1000], [1000, 1000]])
    ], UPM)
    const rings = surfaces.find(s => s.paving === 'busway').polygons.map(poly => poly[0])
    const inside = ([px, py]) => rings.some((ring) => {
      let hit = false
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i]
        const [xj, yj] = ring[j]
        if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) hit = !hit
      }
      return hit
    })
    const halfAt = (x) => {
      let h = 0
      while (inside([x, 1000 + h + 0.02])) h += 0.02
      return h
    }
    const full = rowFor(spec, { kind_detail: 'busway' }).widthM / 2
    // Full width mid-way, and at the join between the two busways (no fade there)...
    expect(halfAt(300)).toBeCloseTo(full, 1)
    expect(halfAt(600)).toBeCloseTo(full, 1)
    // ...narrowing to a point at both dead ends.
    expect(halfAt(999)).toBeLessThan(0.5)
    expect(halfAt(101)).toBeLessThan(0.5)
    expect(halfAt(987)).toBeGreaterThan(0.5)
    expect(halfAt(987)).toBeLessThan(full)
  })

  it('paints the gap between a named road\'s carriageways as a median, only on its stretch', () => {
    // Two one-way carriageways 16 m apart: 10.75 m surfaces leave a 5.25 m gap.
    const pair = (name, y) => [
      feature('primary', [[100, y], [2000, y]], { oneway: 'yes', name }),
      feature('primary', [[2000, y + 16], [100, y + 16]], { oneway: 'yes', name })
    ]
    // The stretch: Rasuna Said, boxed to x 300..1800 (the whole test road's middle).
    const medianStretches = [{ name: 'Rasuna Said', rect: [300, 900, 1800, 1100] }]
    const { surfaces } = buildTile(spec, [...pair('Jalan HR Rasuna Said', 1000), ...pair('Jalan Lain', 1300)], UPM, { medianStretches })
    const median = surfaces.find(s => s.paving === 'median')
    expect(median).toBeDefined()
    // Along the middle of the road (at its test ends, round caps leave a notch the median fills).
    const ys = median.polygons.flatMap(poly => poly[0].filter(([x]) => x > 300 && x < 1800).map(([, y]) => y))
    // Between Rasuna Said's carriageways (their inner edges at 1005.375 and 1010.625)...
    expect(Math.min(...ys)).toBeGreaterThan(1005)
    expect(Math.max(...ys)).toBeLessThan(1011)
    // ...not between the other road's, which has no stretch...
    expect(median.polygons.flatMap(poly => poly[0]).some(([, y]) => y > 1100)).toBe(false)
    // ...and only inside the stretch's box.
    const xs = median.polygons.flatMap(poly => poly[0].map(([x]) => x))
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(299.9)
    expect(Math.max(...xs)).toBeLessThanOrEqual(1800.1)
  })

  it('finds the traffic islands next to a median: small holes in the road, not city blocks', () => {
    const ring = (x0, y0, x1, y1) => toPath([[x0, y0], [x1, y0], [x1, y1], [x0, y1]])
    const cw = r => (Clipper.Area(r) > 0 ? r : [...r].reverse())
    const ccw = r => [...cw(r)].reverse()
    // A road surface with two holes: a 10x10 island and a 200x200 block.
    const paved = [cw(ring(0, 0, 1000, 1000)), ccw(ring(100, 100, 110, 110)), ccw(ring(400, 400, 600, 600))]
    const median = [cw(ring(111, 100, 300, 104))]
    const found = islandsNear(paved, median, 500, 4)
    expect(found).toHaveLength(1)
    // The island, as a polygon wound as an outline.
    expect(Clipper.Area(found[0])).toBeCloseTo(Clipper.Area(cw(ring(100, 100, 110, 110))), -2)
    // Too far from the median, none.
    expect(islandsNear(paved, [cw(ring(150, 150, 300, 154))], 500, 4)).toHaveLength(0)
  })

  it('shapes a traffic island as built: straight sides, rounded tips', () => {
    // A 40 m triangle whose long side wobbles by 0.2 m (the kerb returns' leftovers).
    const wobbly = [[0, 0], [10, 0.2], [20, -0.2], [30, 0.2], [40, 0], [20, 30]]
    const [island] = kerbedIsland(toPath(wobbly), 0.4, 1.5)
    // Clipper paths are in toPath's fixed-point units; one tile unit spans as many as (40, 0) does.
    const unit = toPath([[1, 0]])[0].X
    const xy = island.map(({ X, Y }) => [X / unit, Y / unit])
    // The wobbly side is straight now: nothing on it dips below y = 0 by more than a hair.
    expect(Math.min(...xy.map(([, y]) => y))).toBeGreaterThan(-0.05)
    // The tips are rounded: no vertex reaches the sharp corners.
    for (const [cx, cy] of [[0, 0], [40, 0], [20, 30]]) {
      expect(Math.min(...xy.map(([x, y]) => Math.hypot(x - cx, y - cy)))).toBeGreaterThan(0.5)
    }
  })

  it('merges a divided road: the strip between its carriageways is the median, one name on its centre line', () => {
    const name = 'Jalan Doktor Ide Anak Agung Gde Agung'
    // Two one-way secondaries 20 m apart (centre to centre), running opposite ways.
    const gap = 20 * UPM
    const merged = buildTile(spec, [
      { props: { kind_detail: 'secondary', kind: 'major_road', oneway: 'yes', name }, lines: [[[200, 1000], [1800, 1000]]] },
      { props: { kind_detail: 'secondary', kind: 'major_road', oneway: 'yes', name }, lines: [[[1800, 1000 + gap], [200, 1000 + gap]]] },
      // A crossing road: it cuts the median, and never pairs.
      { props: { kind_detail: 'secondary', kind: 'major_road', oneway: 'no', name: 'Jalan Lain' }, lines: [[[1000, 600], [1000, 1600]]] },
      // A driveway ending at the far carriageway: it must not.
      { props: { kind_detail: 'service', kind: 'minor_road', oneway: 'no' }, lines: [[[1500, 1000 + gap], [1500, 1000 + gap + 60]]] }
    ], UPM, { mergeStretches: [{ name, rect: [0, 0, 4096, 4096], medianM: 3, green: true }] })
    const median = merged.surfaces.find(s => s.paving === 'median')
    expect(median).toBeDefined()
    // medianM wide down the centre line, whatever the gap, cut at the crossing road: two pieces.
    expect(median.polygons.length).toBe(2)
    const half = (3 / 2) * UPM
    for (const poly of median.polygons) {
      const ys = poly[0].map(([, y]) => y)
      expect(Math.min(...ys)).toBeCloseTo(1000 + gap / 2 - half, 1)
      expect(Math.max(...ys)).toBeCloseTo(1000 + gap / 2 + half, 1)
      // Each piece lies wholly to one side of the crossing road's centre.
      const xs = poly[0].map(([x]) => x)
      expect(Math.max(...xs) < 1000 || Math.min(...xs) > 1000).toBe(true)
    }
    // One road kerb to kerb: the gap between the carriageways is paved.
    const asphalt = merged.surfaces.find(s => s.paving === 'asphalt')
    const inside = ([px, py]) => asphalt.polygons.some((poly) => {
      const hit = (ring) => {
        let h = false
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
          const [xi, yi] = ring[i]
          const [xj, yj] = ring[j]
          if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) h = !h
        }
        return h
      }
      return hit(poly[0]) && !poly.slice(1).some(hit)
    })
    expect(inside([600, 1000 + gap / 2])).toBe(true)
    // One name, on the centre line.
    expect(merged.labels).toHaveLength(1)
    expect(merged.labels[0].name).toBe(name)
    for (const line of merged.labels[0].lines) for (const [, y] of line) expect(y).toBeCloseTo(1000 + gap / 2, 0)
    // Close together (Ide Anak Agung's ~10 m between centre lines), a road
    // alongside that never crosses the median (there: a stretch of one
    // carriageway OSM left unnamed) reached over it with its surface and
    // kerb allowance and broke it. Only a road whose line enters it may.
    const tight = 10 * UPM
    const drive = buildTile(spec, [
      { props: { kind_detail: 'secondary', kind: 'major_road', oneway: 'yes', name }, lines: [[[200, 1000], [1800, 1000]]] },
      { props: { kind_detail: 'secondary', kind: 'major_road', oneway: 'yes', name }, lines: [[[1800, 1000 + tight], [200, 1000 + tight]]] },
      { props: { kind_detail: 'secondary', kind: 'major_road', oneway: 'yes' }, lines: [[[900, 1000], [1100, 1000]]] }
    ], UPM, { mergeStretches: [{ name, rect: [0, 0, 4096, 4096], medianM: 3, green: true }] })
    const whole = drive.surfaces.find(s => s.paving === 'median').polygons
    expect(whole).toHaveLength(1)
    // No notch: every vertex lies on one of its two long edges.
    const mid = 1000 + tight / 2
    for (const [, y] of whole[0][0]) expect(Math.abs(Math.abs(y - mid) - 1.5 * UPM)).toBeLessThan(0.05)
    // A busway down the middle (Sudirman's Koridor 1) never breaks the median,
    // and the median never covers it.
    const wide = 30 * UPM
    const withBus = buildTile(spec, [
      { props: { kind_detail: 'primary', kind: 'major_road', oneway: 'yes', name }, lines: [[[200, 1000], [1800, 1000]]] },
      { props: { kind_detail: 'primary', kind: 'major_road', oneway: 'yes', name }, lines: [[[1800, 1000 + wide], [200, 1000 + wide]]] },
      // Two busways, 3 m either side of the centre line: their lines enter a 5 m median.
      { props: { kind_detail: 'busway', kind: 'other', oneway: 'yes', name: 'Transjakarta Busway Koridor 1' }, lines: [[[200, 1000 + wide / 2 - 3], [1800, 1000 + wide / 2 - 3]]] },
      { props: { kind_detail: 'busway', kind: 'other', oneway: 'yes', name: 'Transjakarta Busway Koridor 1' }, lines: [[[1800, 1000 + wide / 2 + 3], [200, 1000 + wide / 2 + 3]]] }
    ], UPM, { mergeStretches: [{ name, rect: [0, 0, 4096, 4096], medianM: 5, green: true }] })
    const busMedian = withBus.surfaces.find(s => s.paving === 'median')
    expect(busMedian).toBeDefined()
    // Whole along its length, and mid-road (away from where the test's busways
    // taper off at their free ends) only between the busways' paving: 3.5 m
    // wide 3 m either side of the centre, so 1.25 m either side of it.
    expect(busMedian.polygons).toHaveLength(1)
    const inMedian = ([px, py]) => busMedian.polygons.some((poly) => {
      const hit = (ring) => {
        let h = false
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
          const [xi, yi] = ring[i]
          const [xj, yj] = ring[j]
          if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) h = !h
        }
        return h
      }
      return hit(poly[0]) && !poly.slice(1).some(hit)
    })
    const centre = 1000 + wide / 2
    expect(inMedian([1000, centre])).toBe(true)
    expect(inMedian([1000, centre + 1])).toBe(true)
    expect(inMedian([1000, centre + 2])).toBe(false)
    expect(inMedian([1000, centre - 2])).toBe(false)
    // A stretch that says nothing gets a plain divider at the default width.
    const plainDivider = buildTile(spec, [
      { props: { kind_detail: 'secondary', kind: 'major_road', oneway: 'yes', name }, lines: [[[200, 1000], [1800, 1000]]] },
      { props: { kind_detail: 'secondary', kind: 'major_road', oneway: 'yes', name }, lines: [[[1800, 1000 + gap], [200, 1000 + gap]]] }
    ], UPM, { mergeStretches: [{ name, rect: [0, 0, 4096, 4096] }] })
    expect(plainDivider.surfaces.some(s => s.paving === 'median')).toBe(false)
    const divider = plainDivider.surfaces.find(s => s.paving === 'divider')
    const dys = divider.polygons.flatMap(poly => poly[0].map(([, y]) => y))
    expect(Math.max(...dys) - Math.min(...dys)).toBeCloseTo(spec.merge.medianM * UPM, 1)
    // Outside a merge stretch, nothing.
    const plain = buildTile(spec, [
      { props: { kind_detail: 'secondary', kind: 'major_road', oneway: 'yes', name }, lines: [[[200, 1000], [1800, 1000]]] },
      { props: { kind_detail: 'secondary', kind: 'major_road', oneway: 'yes', name }, lines: [[[1800, 1000 + gap], [200, 1000 + gap]]] }
    ], UPM)
    expect(plain.surfaces.some(s => s.paving === 'median')).toBe(false)
    expect(plain.labels).toHaveLength(0)
  })

  it('bakes a footbridge and its stairs as one deck, square-ended, with its outline as the rim', () => {
    // A JPO deck across, and a stair leg turning down from its east end (an L).
    const { surfaces, paint } = buildTile(spec, [
      { props: { kind_detail: 'footbridge', kind: 'path', is_bridge: true }, lines: [[[1000, 1000], [2000, 1000]]] },
      { props: { kind_detail: 'steps', kind: 'path' }, lines: [[[2000, 1000], [2000, 1400]]] }
    ], UPM)
    const deck = surfaces.find(s => s.paving === 'footbridge')
    expect(deck.level).toBe('f')
    // One shape, no seam where the stairs meet the deck.
    expect(deck.polygons).toHaveLength(1)
    const xs = deck.polygons[0][0].map(([x]) => x)
    const ys = deck.polygons[0][0].map(([, y]) => y)
    const half = (spec.footbridges.widthM / 2) * UPM
    // Square ends exactly at the line ends: the deck's west end, the stairs' foot.
    expect(Math.min(...xs)).toBeCloseTo(1000, 0)
    expect(Math.max(...ys)).toBeCloseTo(1400, 0)
    expect(Math.max(...xs)).toBeCloseTo(2000 + half, 0)
    const rim = paint.find(p => p.level === 'f' && p.kind === 'kerb')
    expect(rim.lines.length).toBeGreaterThan(0)
    // No roads at all in the tile, and still drawn; jp's levels never include f.
    expect(surfaces.every(s => s.level === 'f')).toBe(true)
  })

  it('paves a narrow gap between a busway and the road beside it as one span, keeping a wide one open', () => {
    // A one-way primary (10.75 m) with a busway (3.5 m) 1 m off its edge, and another 8 m off.
    const near = 1000 + 10.75 / 2 + 1 + 3.5 / 2
    const far = 2000 + 10.75 / 2 + 8 + 3.5 / 2
    const { surfaces } = buildTile(spec, [
      feature('primary', [[100, 1000], [2000, 1000]], { oneway: 'yes' }),
      feature('busway', [[100, near], [2000, near]]),
      feature('primary', [[100, 2000], [2000, 2000]], { oneway: 'yes' }),
      feature('busway', [[100, far], [2000, far]])
    ], UPM)
    const rings = surfaces.find(s => s.paving === 'asphalt').polygons.map(poly => poly)
    const inside = ([px, py]) => rings.some((poly) => {
      const hit = (ring) => {
        let h = false
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
          const [xi, yi] = ring[i]
          const [xj, yj] = ring[j]
          if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) h = !h
        }
        return h
      }
      return hit(poly[0]) && !poly.slice(1).some(hit)
    })
    // The 1 m gap is road now...
    expect(inside([1000, 1000 + 10.75 / 2 + 0.5])).toBe(true)
    // ...the 8 m one is still open ground.
    expect(inside([1000, 2000 + 10.75 / 2 + 4])).toBe(false)
  })

  it('drops a bridge\'s kerb across its square ends, keeping its sides', () => {
    const { paint } = buildTile(spec, [
      feature('tertiary', [[100, 1000], [1000, 1000]]),
      feature('tertiary', [[1000, 1000], [1100, 1000]], { is_bridge: true }),
      feature('tertiary', [[1100, 1000], [2000, 1000]])
    ], UPM)
    const kerb = sample(paint.filter(p => p.kind === 'kerb' && p.level === 'b').flatMap(p => p.lines))
    // Its sides, along the deck...
    expect(kerb.some(([x, y]) => x > 1040 && x < 1060 && Math.abs(Math.abs(y - 1000) - 3.5) < 0.2)).toBe(true)
    // ...but nothing across its ends.
    expect(kerb.some(([x, y]) => (Math.abs(x - 1000) < 0.2 || Math.abs(x - 1100) < 0.2) && Math.abs(y - 1000) < 3)).toBe(false)
  })

  it('bakes a tunnel as its own surface, and ends the roads at its portals square', () => {
    const { surfaces } = buildTile(spec, [
      feature('tertiary', [[100, 1000], [1000, 1000]]),
      feature('tertiary', [[1000, 1000], [1100, 1000]], { is_tunnel: true }),
      feature('tertiary', [[1100, 1000], [2000, 1000]])
    ], UPM)
    const tunnel = surfaces.find(s => s.level === 't' && s.paving === 'tunnel')
    expect(tunnel.polygons.length).toBe(1)
    const xs = tunnel.polygons[0][0].map(([x]) => x)
    expect(Math.min(...xs)).toBeCloseTo(1000, 0)
    expect(Math.max(...xs)).toBeCloseTo(1100, 0)
    // The ground road stops square at the portal, not with a round end over the tunnel.
    const asphalt = surfaces.find(s => s.level === 'g' && s.paving === 'asphalt').polygons
    const groundXs = asphalt.flatMap(poly => poly[0].map(([x]) => x))
    expect(groundXs.some(x => x > 1001 && x < 1099)).toBe(false)
  })

  it('paves motorways and their ramps as highway, and nothing else', () => {
    const { surfaces } = buildTile(spec, [
      feature('motorway', [[100, 1000], [3000, 1000]]),
      feature('motorway_link', [[1500, 1000], [1600, 1100]], { is_link: true }),
      feature('primary', [[100, 2000], [3000, 2000]])
    ], UPM)
    const highway = surfaces.filter(s => s.paving === 'highway')
    expect(highway.length).toBe(1)
    const inside = ([px, py]) => highway[0].polygons.some((poly) => {
      let hit = false
      for (let i = 0, j = poly[0].length - 1; i < poly[0].length; j = i++) {
        const [xi, yi] = poly[0][i]
        const [xj, yj] = poly[0][j]
        if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) hit = !hit
      }
      return hit
    })
    expect(inside([800, 1000])).toBe(true)
    expect(inside([1580, 1080])).toBe(true)
    expect(inside([800, 2000])).toBe(false)
  })

  it('keeps a kerb return that closing welded to a long hairline sliver', () => {
    // An access road runs beside the side street, 0.3 m off its east edge:
    // closing fills that 100 m gap in one piece with the east kerb return,
    // too long to pass as a kerb whole (as on Jalan Sawo).
    const { paint } = buildTile(spec, [
      feature('tertiary', [[100, 1000], [3000, 1000]]),
      feature('residential', [[1500, 1000], [1500, 1120]]),
      feature('service', [[1504.8, 1012], [1504.8, 1112]])
    ], UPM)
    const edge = sample(paint.filter(p => p.colour === 'white' && p.width === 0.15).flatMap(p => p.lines))
    expect(edge.some(([x, y]) => x > 1502.5 && x < 1508 && y > 1003.2 && y < 1008)).toBe(true)
  })

  it('clears the inside of a fork\'s shared stretch, keeping only its two outer edges', () => {
    // Two one-way collectors leave a node 3 m apart per 100 m: their 7 m
    // carriageways overlap for ~230 m before they separate.
    const { paint } = buildTile(spec, [
      feature('tertiary', [[500, 2000], [1000, 2000]], { oneway: 'yes' }),
      feature('tertiary', [[1000, 2000], [2000, 2000]], { oneway: 'yes' }),
      feature('tertiary', [[1000, 2000], [2000, 2030]], { oneway: 'yes' })
    ], UPM)
    // Markings only: the kerb outline (light and dark's) runs everywhere.
    const lines = paint.filter(p => p.kind !== 'kerb').flatMap(p => p.lines)
    // Along the shared stretch, paint may only sit on the straight branch's
    // outer edge (y 1997) or the diverging branch's outer edge (3 m left of
    // its centreline): every centre dash and inner edge is cut.
    const onOuterEdge = ([x, y]) => Math.abs(y - 1997) < 0.3 || Math.abs(y - (2003 + 0.03 * (x - 1000))) < 0.3
    // (The diverging branch's centreline leaves the straight branch's 3.5 m
    // half-width at x ≈ 1117, after which it is its own lane and is painted.)
    const inShared = sample(lines).filter(([x]) => x > 1010 && x < 1110)
    expect(inShared.length).toBeGreaterThan(0)
    for (const p of inShared) expect(onOuterEdge(p), `paint at ${p}`).toBe(true)
    // Once the branches have separated, each has its full markings again.
    expect(lines.some(l => l.some(([x, y]) => x > 1600 && Math.abs(y - 2000) < 0.01))).toBe(true)
  })

  it('cuts jp\'s bus lane at a junction, but keeps light and dark\'s busway whole through it', () => {
    const { surfaces } = buildTile(spec, [
      feature('busway', [[500, 1000], [2500, 1000]]),
      feature('tertiary', [[1500, 900], [1500, 1100]])
    ], UPM)
    const across = paving => surfaces.filter(s => s.paving === paving).flatMap(s => s.polygons).some((poly) => {
      const xs = poly[0].map(([x]) => x)
      return Math.min(...xs) < 1400 && Math.max(...xs) > 1600
    })
    expect(across('busLane')).toBe(false)
    expect(across('busway')).toBe(true)
  })

  it('keeps a median bus lane whole where a too-wide road overlaps it (Galunggung)', () => {
    // A one-way primary (guessed 10.75 m wide) with a busway 4 m off its
    // centreline: their carriageways overlap along the whole stretch, and
    // they meet at a node at the start, as OSM median busways do.
    const { surfaces, paint } = buildTile(spec, [
      feature('primary', [[500, 1000], [2500, 1000]], { oneway: 'yes' }),
      feature('busway', [[500, 1000], [600, 1004], [2500, 1004]], { oneway: 'yes' })
    ], UPM)
    const bus = surfaces.find(s => s.paving === 'busLane')
    expect(bus.polygons.length).toBe(1)
    const xs = bus.polygons[0][0].map(([x]) => x)
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(1500)
    // The busway keeps its yellow lines along the stretch...
    const yellow = paint.filter(p => p.colour === 'yellow').flatMap(p => p.lines)
    expect(yellow.some(l => l.some(([x]) => x > 2000))).toBe(true)
    // ...and no white car marking runs inside the bus lane (y 1002.25..1005.75).
    const white = paint.filter(p => p.colour === 'white').flatMap(p => p.lines)
    // (Up to where the busway ends; past it the primary's rounded end wraps round.)
    for (const [x, y] of sample(white)) if (x > 700 && x < 2400) expect(y < 1002.2 || y > 1005.8, `white at ${x},${y}`).toBe(true)
  })

  it('ends a bridge surface square, so it does not spill over the road beyond', () => {
    const { surfaces } = buildTile(spec, [
      feature('primary', [[500, 1000], [1500, 1000]], { oneway: 'yes' }),
      feature('primary', [[1500, 1000], [2500, 1000]], { oneway: 'yes', is_bridge: true })
    ], UPM)
    const bridge = surfaces.find(s => s.level === 'b')
    const xs = bridge.polygons.flatMap(poly => poly[0].map(([x]) => x))
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(1500 - 0.1)
  })

  it('gives a service road a surface but no edge line, and runs the marked road\'s edge past its mouth', () => {
    const { surfaces, paint } = buildTile(spec, [
      feature('tertiary', [[100, 1000], [3000, 1000]]),
      feature('service', [[1500, 1000], [1500, 1100]])
    ], UPM)
    expect(surfaces.find(s => s.paving === 'asphalt').polygons.length).toBe(1)
    const edge = sample(paint.filter(p => p.colour === 'white' && p.width === 0.15).flatMap(p => p.lines))
    expect(edge.some(([x, y]) => Math.abs(x - 1500) < 0.3 && Math.abs(y - 1003) < 0.1)).toBe(true)
    expect(edge.some(([, y]) => y > 1010)).toBe(false)
  })

  it('shares one shoulder width across every outlined row', () => {
    const shoulders = new Set(spec.rows.filter(r => !r.edgesAlongRoad).flatMap(r => r.lines.filter(l => l.edge).map(l => r.widthM / 2 - l.offsetM)))
    expect([...shoulders]).toEqual([0.5])
  })

  it('stops bus-lane paving where a road crosses the busway', () => {
    const { surfaces } = buildTile(spec, [
      feature('busway', [[100, 1000], [3000, 1000]], { oneway: 'yes' }),
      feature('tertiary', [[1500, 100], [1500, 3000]])
    ], UPM)
    const bus = surfaces.find(s => s.paving === 'busLane')
    expect(bus.polygons.length).toBe(2)
  })
})

describe('encodeBuilt', () => {
  it('writes surface polygons with MVT winding and paint lines that read back', () => {
    const built = buildTile(spec, [feature('tertiary', [[100, 1000], [3000, 1000]])], UPM)
    const tile = new Uint8Array(encodeBuilt(built))
    const surface = decodeLayer(tile, 'surface')
    const paint = decodeLayer(tile, 'paint')
    expect(surface.extent).toBe(8192)
    expect(surface.features[0]).toMatchObject({ type: 3, props: { l: 'g', p: 'asphalt' } })
    expect(ringArea(surface.features[0].rings[0])).toBeGreaterThan(0)
    // The kerb outline, the edge lines and the centre dashes, each tagged by kind.
    expect(paint.features.map(f => `${f.props.k}:${f.props.c}`).sort()).toEqual(['edge:white', 'kerb:kerb', 'mark:white'])
    expect(paint.features[0].type).toBe(2)
  })
})
