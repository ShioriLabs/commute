import { describe, expect, it } from 'vitest'
import skeleton from '../app/data/map-skeleton.json'
import manifest from '../public/maps/fdtj/manifest.json'
import {
  FDTJ_ANCHOR_X,
  FDTJ_ANCHOR_Y,
  FDTJ_MAP_H,
  FDTJ_MAP_W,
  previewCamera
} from './map-morph-camera'
import points from '../app/data/points.json'
import {
  FDTJ_SPAWNS,
  orderSkeleton,
  orderStations,
  parsePath,
  type SkeletonStroke
} from './map-skeleton-order'

const SPAN = 280

function stroke(c: string, d: string, w = 15): SkeletonStroke {
  const points = parsePath(d)
  const xs = points.map(p => p[0])
  const ys = points.map(p => p[1])
  return { c, w, cx: (Math.min(...xs) + Math.max(...xs)) / 2, cy: (Math.min(...ys) + Math.max(...ys)) / 2, d }
}

function distance(point: number[], x: number, y: number): number {
  return Math.hypot(point[0] - x, point[1] - y)
}

describe('orderSkeleton', () => {
  it('orients every stroke so it draws away from the anchor', () => {
    // Second stroke's data runs toward the anchor; it must come back reversed.
    const result = orderSkeleton([
      stroke('#AAA', 'M10 0L200 0L400 0'),
      stroke('#BBB', 'M400 0L200 0L10 0')
    ], 0, 0, SPAN)

    for (const item of result) {
      const points = parsePath(item.d)
      expect(distance(points[0], 0, 0)).toBeLessThanOrEqual(distance(points[points.length - 1], 0, 0))
    }
  })

  it('splits a stroke that passes through the anchor so both halves grow outward', () => {
    // The middle vertex is the closest point, so this becomes two strokes.
    const result = orderSkeleton([stroke('#AAA', 'M-300 0L0 0L300 0')], 0, 0, SPAN)

    expect(result).toHaveLength(2)
    for (const item of result) {
      const points = parsePath(item.d)
      expect(points[0]).toEqual([0, 0])
      expect(distance(points[points.length - 1], 0, 0)).toBe(300)
    }
  })

  it('leaves a stroke whole when the anchor is nearest one of its ends', () => {
    const result = orderSkeleton([stroke('#AAA', 'M10 0L200 0L400 0')], 0, 0, SPAN)
    expect(result).toHaveLength(1)
    expect(result[0].d).toBe('M10 0L200 0L400 0')
  })

  it('delays groups by distance, spanning the full range', () => {
    const result = orderSkeleton([
      stroke('#FAR', 'M9000 9000L9400 9000'),
      stroke('#NEAR', 'M10 10L400 10'),
      stroke('#MID', 'M3000 3000L3400 3000')
    ], 0, 0, SPAN)

    const delayOf = (c: string) => result.find(item => item.c === c)!.delayMs
    expect(delayOf('#NEAR')).toBe(0)
    expect(delayOf('#FAR')).toBe(SPAN)
    expect(delayOf('#MID')).toBeGreaterThan(0)
    expect(delayOf('#MID')).toBeLessThan(SPAN)
  })

  it('gives every piece of one corridor the same delay', () => {
    const result = orderSkeleton([
      stroke('#AAA', 'M10 10L400 10'),
      stroke('#AAA', 'M4000 4000L4400 4000'),
      stroke('#BBB', 'M2000 2000L2400 2000')
    ], 0, 0, SPAN)

    const aaa = result.filter(item => item.c === '#AAA').map(item => item.delayMs)
    expect(new Set(aaa).size).toBe(1)
  })

  it('separates strokes that share a colour but not a width', () => {
    const result = orderSkeleton([
      stroke('#AAA', 'M10 10L400 10', 15),
      stroke('#AAA', 'M4000 4000L4400 4000', 25)
    ], 0, 0, SPAN)

    expect(new Set(result.map(item => item.delayMs)).size).toBe(2)
  })

  it('does not divide by zero on a single group or empty input', () => {
    expect(orderSkeleton([], 0, 0, SPAN)).toEqual([])
    const single = orderSkeleton([stroke('#AAA', 'M10 10L400 10')], 0, 0, SPAN)
    expect(single).toHaveLength(1)
    expect(single[0].delayMs).toBe(0)
  })

  it('drops degenerate strokes rather than emitting an unanimatable path', () => {
    expect(orderSkeleton([stroke('#AAA', 'M10 10')], 0, 0, SPAN)).toEqual([])
  })
})

describe('map-skeleton.json stays in sync with the map', () => {
  it('describes the same coordinate space as the manifest', () => {
    expect(skeleton.viewBox).toEqual(manifest.viewBox)
    expect(skeleton.viewBox[2]).toBe(FDTJ_MAP_W)
    expect(skeleton.viewBox[3]).toBe(FDTJ_MAP_H)
    expect(skeleton.version).toBe(manifest.version)
  })

  it('contains enough lines to be worth animating', () => {
    // The floor that catches a future map edition silently defeating the build script's
    // colour/width predicate — the failure mode is a thin animation, not an error.
    expect(skeleton.strokes.length).toBeGreaterThanOrEqual(12)
  })

  it('is rail only', () => {
    // TransJakarta's BRT mesh is stroked at 15 and deliberately excluded; if it ever comes
    // back the animation silently doubles in density, which is the thing to catch.
    for (const item of skeleton.strokes) expect(item.w).toBe(25)
  })

  it('emits only absolute integer polylines inside the viewBox', () => {
    for (const item of skeleton.strokes) {
      expect(item.d).toMatch(/^M-?\d+ -?\d+(L-?\d+ -?\d+)+$/)
      expect(item.c).toMatch(/^#[0-9A-F]{6}$/)
      for (const [x, y] of parsePath(item.d)) {
        expect(x).toBeGreaterThanOrEqual(-50)
        expect(x).toBeLessThanOrEqual(FDTJ_MAP_W + 50)
        expect(y).toBeGreaterThanOrEqual(-50)
        expect(y).toBeLessThanOrEqual(FDTJ_MAP_H + 50)
      }
    }
  })

  it('orders the real map without leaving a stroke pointing inward', () => {
    const result = orderSkeleton(skeleton.strokes, FDTJ_ANCHOR_X, FDTJ_ANCHOR_Y, SPAN)
    expect(result.length).toBeGreaterThanOrEqual(skeleton.strokes.length)

    for (const item of result) {
      const points = parsePath(item.d)
      const head = distance(points[0], FDTJ_ANCHOR_X, FDTJ_ANCHOR_Y)
      const tail = distance(points[points.length - 1], FDTJ_ANCHOR_X, FDTJ_ANCHOR_Y)
      expect(head).toBeLessThanOrEqual(tail)
      expect(item.delayMs).toBeGreaterThanOrEqual(0)
      expect(item.delayMs).toBeLessThanOrEqual(SPAN)
    }
  })
})

describe('per-line spawn points', () => {
  const spawnOf = (id: string) => {
    const p = points.points.find(x => x.id === id)!
    return { x: (p.ax + p.bx) / 2, y: (p.ay + p.by) / 2 }
  }
  const ordered = orderSkeleton(skeleton.strokes, FDTJ_ANCHOR_X, FDTJ_ANCHOR_Y, SPAN)
  const startsNear = (colour: string, at: { x: number, y: number }) =>
    ordered
      .filter(item => item.c === colour)
      .map(item => parsePath(item.d)[0])
      .filter(head => distance(head, at.x, at.y) < 150)

  it('keeps the hardcoded coordinates in sync with points.json', () => {
    for (const [id, colour] of [
      ['MRTJ-BHI', '#CA2B51'],
      ['LRTJBDB-DKA', '#026C3E'],
      ['LRTJBDB-DKA', '#1251A2'],
      ['KCI-JNG', '#00BDEF']
    ] as const) {
      const spawn = FDTJ_SPAWNS.find(s => s.c === colour)!
      const station = spawnOf(id)
      expect(spawn.x).toBeCloseTo(station.x, 9)
      expect(spawn.y).toBeCloseTo(station.y, 9)
    }
  })

  it('starts MRT Jakarta at Bundaran HI', () => {
    expect(startsNear('#CA2B51', spawnOf('MRTJ-BHI'))).toHaveLength(1)
  })

  it('draws MRT Jakarta as one line, not one per source stroke', () => {
    // The PDF splits MRT into three strokes meeting at Istora and Fatmawati. Chaining has
    // to fuse them, or the two the spawn does not touch sprout their own origins — the
    // line was visibly growing out of Istora and Bundaran HI at once.
    const mrt = ordered.filter(item => item.c === '#CA2B51')
    const istora = spawnOf('MRTJ-IST')
    const fatmawati = spawnOf('MRTJ-FTM')
    expect(startsNear('#CA2B51', istora)).toHaveLength(0)
    expect(startsNear('#CA2B51', fatmawati)).toHaveLength(0)

    // And the surviving line has to actually span the route, Bundaran HI through to
    // Lebak Bulus, rather than having merely dropped the pieces it could not place.
    const line = mrt.find(item => distance(parsePath(item.d)[0], spawnOf('MRTJ-BHI').x, spawnOf('MRTJ-BHI').y) < 150)!
    const path = parsePath(line.d)
    const passesNear = (at: { x: number, y: number }) =>
      path.some(p => distance(p, at.x, at.y) < 150)
    expect(passesNear(istora)).toBe(true)
    expect(passesNear(fatmawati)).toBe(true)
    expect(distance(path[path.length - 1], spawnOf('MRTJ-LBB').x, spawnOf('MRTJ-LBB').y)).toBeLessThan(150)
  })

  it('starts both LRT Jabodebek branches at Dukuh Atas', () => {
    const dukuhAtas = spawnOf('LRTJBDB-DKA')
    expect(startsNear('#026C3E', dukuhAtas)).toHaveLength(1)
    expect(startsNear('#1251A2', dukuhAtas)).toHaveLength(1)
  })

  it('starts the Cikarang loop Pasar Senen arc at Jatinegara, heading for Kampung Bandan', () => {
    const jatinegara = spawnOf('KCI-JNG')
    const heads = startsNear('#00BDEF', jatinegara)
    expect(heads).toHaveLength(1)

    // The arc must run Jatinegara -> Pasar Senen -> Kampung Bandan in that order, which is
    // the whole point of the override: drawn the other way it unzips away from the loop's
    // closing point instead of towards it.
    const arc = ordered.find(item => item.c === '#00BDEF' && distance(parsePath(item.d)[0], jatinegara.x, jatinegara.y) < 150)!
    const nearestIndex = (at: { x: number, y: number }) => {
      const path = parsePath(arc.d)
      let best = Infinity
      let index = -1
      path.forEach((p, i) => {
        const d = distance(p, at.x, at.y)
        if (d >= best) return
        best = d
        index = i
      })
      return index
    }
    expect(nearestIndex(spawnOf('KCI-PSE'))).toBeLessThan(nearestIndex(spawnOf('KCI-KPB')))
  })

  it('does not leak a spawn onto other strokes of the same colour', () => {
    // MRT is drawn as three strokes but only one ends at Bundaran HI, and the Cikarang
    // main line runs through Jatinegara without terminating there.
    const jatinegara = spawnOf('KCI-JNG')
    const cikarang = ordered.filter(item => item.c === '#00BDEF')
    expect(cikarang.length).toBeGreaterThan(1)
    expect(cikarang.filter(item => distance(parsePath(item.d)[0], jatinegara.x, jatinegara.y) < 150)).toHaveLength(1)
  })

  it('leaves unmatched lines anchored on Manggarai', () => {
    const plain = orderSkeleton(skeleton.strokes, FDTJ_ANCHOR_X, FDTJ_ANCHOR_Y, SPAN, [])
    const spawnColours = new Set(FDTJ_SPAWNS.map(s => s.c))
    const key = (list: typeof plain) => list.filter(i => !spawnColours.has(i.c)).map(i => i.d).join('|')
    expect(key(ordered)).toBe(key(plain))
  })
})

describe('station markers', () => {
  const strokes = orderSkeleton(skeleton.strokes, FDTJ_ANCHOR_X, FDTJ_ANCHOR_Y, SPAN)
  const STROKE_MS = 620
  const stations = orderStations(skeleton.stations, strokes, STROKE_MS)

  it('keeps every marker, each on a line that exists', () => {
    expect(skeleton.stations.length).toBeGreaterThanOrEqual(60)
    expect(stations).toHaveLength(skeleton.stations.length)
    const colours = new Set(skeleton.strokes.map(s => s.c))
    for (const station of skeleton.stations) expect(colours).toContain(station.c)
  })

  it('gives an interchange one marker per line it serves', () => {
    // Manggarai is three discs on one diagonal — Bogor, Cikarang and the loop — and it
    // sits dead centre of the loading camera, so an interchange rendered as a single dot
    // (or, as it was, skipped entirely) is the most visible thing on the screen to get
    // wrong. Their positions come from the artwork, not from the tap-target capsule.
    const here = skeleton.stations.filter(s => distance([s.x, s.y], 4867, 3863) < 80)
    expect(here).toHaveLength(3)
    expect(new Set(here.map(s => s.c))).toEqual(new Set(['#EF3637', '#00BDEF', '#282A65']))
  })

  it('finds every MRT Jakarta station', () => {
    // 13 is the real count, so this catches the disc predicate drifting either way.
    expect(skeleton.stations.filter(s => s.c === '#CA2B51')).toHaveLength(13)
  })

  it('carries markers sized as the tiles draw them', () => {
    for (const station of skeleton.stations) {
      expect(station.r).toBeGreaterThanOrEqual(18)
      expect(station.r).toBeLessThanOrEqual(28)
      expect(station.c).toMatch(/^#[0-9A-F]{6}$/)
      expect(Number.isInteger(station.x)).toBe(true)
      expect(Number.isInteger(station.y)).toBe(true)
    }
  })

  it('pops each marker while its own line is being stroked, never before it starts', () => {
    for (const station of stations) {
      const line = strokes.find(s => s.c === station.c)!
      const earliest = Math.min(...strokes.filter(s => s.c === station.c).map(s => s.delayMs))
      const latest = Math.max(...strokes.filter(s => s.c === station.c).map(s => s.delayMs))
      expect(station.delayMs).toBeGreaterThanOrEqual(earliest)
      expect(station.delayMs).toBeLessThanOrEqual(latest + STROKE_MS)
      expect(Number.isFinite(line.delayMs)).toBe(true)
    }
  })

  it('places a marker later the further along its line it sits', () => {
    // Bogor line: Cikini is north of Manggarai and the line is split at the anchor, so
    // both halves start there — a marker near the split must precede one at the far end.
    const bogor = stations.filter(s => s.c === '#EF3637').sort((a, b) => a.delayMs - b.delayMs)
    expect(bogor.length).toBeGreaterThan(2)
    expect(bogor[0].delayMs).toBeLessThan(bogor[bogor.length - 1].delayMs)
  })

  it('drops a marker whose line is not in the skeleton', () => {
    const orphan = [{ x: 0, y: 0, r: 22, c: '#123456' }]
    expect(orderStations(orphan, strokes, STROKE_MS)).toEqual([])
  })
})

describe('the draw radiates from the middle of the screen at any size', () => {
  // The whole premise of anchoring the animation on Manggarai: previewCamera() centers it
  // on every viewport, because the map at scale 0.5 (4757x3363 CSS px) is larger than any
  // real screen on both axes, so neither clamp binds.
  it.each([
    ['phone', 390, 844],
    ['tablet', 820, 1180],
    ['laptop', 1440, 900],
    ['desktop', 1920, 1080],
    ['4K', 3840, 2160]
  ])('puts the anchor at the viewport center on %s', (_name, width, height) => {
    const { tx, ty, scale } = previewCamera(width, height)
    expect(tx + FDTJ_ANCHOR_X * scale).toBeCloseTo(width / 2, 6)
    expect(ty + FDTJ_ANCHOR_Y * scale).toBeCloseTo(height / 2, 6)
  })
})
