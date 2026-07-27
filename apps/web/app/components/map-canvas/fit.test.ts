import { describe, expect, it } from 'vitest'
import type { Point } from '../../lib/map-renderer'
import { boundsOf, clampTransform, fitTransform, minScaleFor } from './fit'

// A circular tap target: a→b collapse to one world position, `r` is the radius.
const dot = (id: string, x: number, y: number, r = 20): Point =>
  ({ id, ax: x, ay: y, bx: x, by: y, r })

// Viewport and map dimensions used across the fit cases. The map is much larger
// than the viewport on both axes, matching the real FDTJ sheet (9513×6726).
const VIEWPORT_W = 400
const VIEWPORT_H = 800
const MAP_W = 9513
const MAP_H = 6726

describe('minScaleFor', () => {
  // max() not min(): the short axis fills the viewport and the long axis
  // overflows, so the map is pannable with no letterbox bars.
  it('fills the shorter dimension rather than fitting the whole map', () => {
    expect(minScaleFor(VIEWPORT_W, VIEWPORT_H, MAP_W, MAP_H)).toBeCloseTo(VIEWPORT_H / MAP_H)
  })

  it('falls back to a tiny scale before the viewport is measured', () => {
    expect(minScaleFor(0, 0, MAP_W, MAP_H)).toBe(0.01)
  })
})

describe('boundsOf', () => {
  it('expands each point by its radius', () => {
    expect(boundsOf([dot('KCI-MRI', 100, 200, 20)])).toEqual({
      minX: 80, minY: 180, maxX: 120, maxY: 220
    })
  })

  it('unions several points', () => {
    const bounds = boundsOf([dot('a', 100, 100, 10), dot('b', 300, 500, 10)])
    expect(bounds).toEqual({ minX: 90, minY: 90, maxX: 310, maxY: 510 })
  })

  it('returns null for no points', () => {
    expect(boundsOf([])).toBeNull()
  })
})

describe('fitTransform', () => {
  it('returns null for an empty list so callers can fall back to an anchor', () => {
    expect(fitTransform([], VIEWPORT_W, VIEWPORT_H, MAP_W, MAP_H, 0, 0.5)).toBeNull()
  })

  // A lone dot is still a 40-unit box once its radius counts, so fitting it
  // literally would pin scale to MAX_SCALE. Fit only zooms out.
  it('keeps the preferred scale for a single point instead of zooming to its radius', () => {
    const t = fitTransform([dot('KCI-MRI', 4000, 3000)], VIEWPORT_W, VIEWPORT_H, MAP_W, MAP_H, 0, 0.5)
    expect(t).not.toBeNull()
    expect(t!.scale).toBeCloseTo(0.5)
  })

  it('never zooms in past the preferred scale for a tight cluster', () => {
    const t = fitTransform(
      [dot('a', 4000, 3000), dot('b', 4100, 3050)],
      VIEWPORT_W, VIEWPORT_H, MAP_W, MAP_H, 0, 0.5
    )!
    expect(t.scale).toBeLessThanOrEqual(0.5)
  })

  it('centres a single point horizontally in the viewport', () => {
    const t = fitTransform([dot('KCI-MRI', 4000, 3000)], VIEWPORT_W, VIEWPORT_H, MAP_W, MAP_H, 0, 0.5)!
    const screenX = 4000 * t.scale + t.tx
    expect(screenX).toBeCloseTo(VIEWPORT_W / 2)
  })

  it('zooms out for a spread pair relative to a tight one', () => {
    const spread = fitTransform(
      [dot('a', 3000, 2500), dot('b', 5000, 3500)],
      VIEWPORT_W, VIEWPORT_H, MAP_W, MAP_H, 0, 0.5
    )!
    const tight = fitTransform(
      [dot('a', 3000, 2500), dot('b', 3200, 2600)],
      VIEWPORT_W, VIEWPORT_H, MAP_W, MAP_H, 0, 0.5
    )!
    expect(spread.scale).toBeLessThan(tight.scale)
  })

  it('keeps both points on screen when the span is narrow enough to fit', () => {
    const points = [dot('a', 3000, 2500), dot('b', 5000, 3500)]
    const t = fitTransform(points, VIEWPORT_W, VIEWPORT_H, MAP_W, MAP_H, 0, 0.5)!
    for (const p of points) {
      expect(p.ax * t.scale + t.tx).toBeGreaterThanOrEqual(0)
      expect(p.ax * t.scale + t.tx).toBeLessThanOrEqual(VIEWPORT_W)
      expect(p.ay * t.scale + t.ty).toBeGreaterThanOrEqual(0)
      expect(p.ay * t.scale + t.ty).toBeLessThanOrEqual(VIEWPORT_H)
    }
  })

  // The peeked sheet covers the bottom of the screen, so the fitted box has to
  // sit in the gap above it, not behind it.
  it('keeps the fitted box above bottomInset', () => {
    const inset = 240
    const points = [dot('a', 3000, 2500), dot('b', 5000, 3500)]
    const t = fitTransform(points, VIEWPORT_W, VIEWPORT_H, MAP_W, MAP_H, inset, 0.5)!
    const bounds = boundsOf(points)!
    const bottomOnScreen = bounds.maxY * t.scale + t.ty
    expect(bottomOnScreen).toBeLessThanOrEqual(VIEWPORT_H - inset)
  })

  // minScale keeps the map's short axis filled, so stations far enough apart
  // simply cannot all be shown — they centre at minimum zoom instead.
  it('clamps to minScale when the span is too wide to ever fit', () => {
    const t = fitTransform(
      [dot('a', 0, 0), dot('b', MAP_W, MAP_H)],
      VIEWPORT_W, VIEWPORT_H, MAP_W, MAP_H, 0, 0.5
    )!
    expect(t.scale).toBeCloseTo(minScaleFor(VIEWPORT_W, VIEWPORT_H, MAP_W, MAP_H))
  })
})

describe('clampTransform', () => {
  it('centres the map on an axis where it is smaller than the viewport', () => {
    // scale small enough that the whole map is narrower than the viewport
    const scale = 0.01
    const t = clampTransform({ tx: -9999, ty: 0, scale }, VIEWPORT_W, VIEWPORT_H, MAP_W, MAP_H, scale)
    expect(t.tx).toBeCloseTo((VIEWPORT_W - MAP_W * scale) / 2)
  })

  it('stops the map edge being dragged inside the viewport', () => {
    const scale = minScaleFor(VIEWPORT_W, VIEWPORT_H, MAP_W, MAP_H)
    // Try to drag the map far to the right, exposing empty space on the left.
    const t = clampTransform({ tx: 500, ty: 0, scale }, VIEWPORT_W, VIEWPORT_H, MAP_W, MAP_H, scale)
    expect(t.tx).toBe(0)
  })

  it('clamps scale into the allowed range', () => {
    const minScale = 0.1
    expect(clampTransform({ tx: 0, ty: 0, scale: 99 }, VIEWPORT_W, VIEWPORT_H, MAP_W, MAP_H, minScale).scale).toBe(1.5)
    expect(clampTransform({ tx: 0, ty: 0, scale: 0.0001 }, VIEWPORT_W, VIEWPORT_H, MAP_W, MAP_H, minScale).scale).toBe(minScale)
  })
})
