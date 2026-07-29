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
import { orderSkeleton, parsePath, type SkeletonStroke } from './map-skeleton-order'

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
