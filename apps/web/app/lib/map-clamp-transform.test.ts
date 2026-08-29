import { describe, expect, it } from 'vitest'
import { MAX_SCALE, clampTransform, minScaleFor } from './map-clamp-transform'

/*
 * The clamp is the single gate every camera write passes through, so a mistake
 * here is not one broken feature but a broken map: drag, inertia, pinch,
 * double-tap, fly-to and fit-bounds all land on it.
 *
 * The inset argument is what lets the desktop side pane's 432px band be panned
 * clear of, and getting it wrong is quiet in exactly the way
 * map-surface-inset.test.ts describes — the map still draws, just with the
 * westernmost stations stuck underneath the pane where nothing can reach them.
 */

// The real FDTJ artwork (public/maps/fdtj/manifest.json viewBox) and the real
// pane band (SIDE_PANE_OCCUPIED_PX), so the numbers below are the ones that
// actually ship rather than round stand-ins.
const MAP_W = 9513.57
const MAP_H = 6726.88
const PANE = 432
// A typical desktop viewport.
const VW = 1440
const VH = 900

describe('minScaleFor', () => {
  it('covers the viewport so no letterbox bars appear', () => {
    // max(1440/9513.57, 900/6726.88): the scaled map is never smaller than
    // the viewport on either axis.
    const s = minScaleFor(VW, VH, MAP_W, MAP_H)
    expect(MAP_W * s).toBeGreaterThanOrEqual(VW - 1e-6)
    expect(MAP_H * s).toBeGreaterThanOrEqual(VH - 1e-6)
  })

  it('falls back to a sane floor before the viewport has been measured', () => {
    expect(minScaleFor(0, 0, MAP_W, MAP_H)).toBe(0.01)
  })

  /*
   * Deliberately NOT inset-aware, and the test is here to keep it that way.
   * Threading the pane band through the width term looks like the obvious way
   * to buy pan slack at minimum zoom, but max() takes whichever axis binds —
   * on this viewport the width does, so subtracting the band would LOWER the
   * floor and let the artwork shrink away from the edges it must cover. The
   * slack comes from clampTransform's shifted upper bound instead.
   */
  it('takes whichever axis binds, width included', () => {
    expect(minScaleFor(VW, VH, MAP_W, MAP_H)).toBeCloseTo(VW / MAP_W, 10)
    expect(VW / MAP_W).toBeGreaterThan(VH / MAP_H)
  })
})

describe('clampTransform', () => {
  const min = minScaleFor(VW, VH, MAP_W, MAP_H)

  describe('with no inset (today’s behaviour)', () => {
    it('clamps the scale into [minScale, MAX_SCALE]', () => {
      expect(clampTransform({ tx: 0, ty: 0, scale: 99 }, VW, VH, MAP_W, MAP_H, min).scale).toBe(MAX_SCALE)
      expect(clampTransform({ tx: 0, ty: 0, scale: 0 }, VW, VH, MAP_W, MAP_H, min).scale).toBe(min)
    })

    it('never lets the left edge come inside the viewport', () => {
      // Asking to push the map right by 500px is refused outright.
      expect(clampTransform({ tx: 500, ty: 0, scale: min }, VW, VH, MAP_W, MAP_H, min).tx).toBe(0)
    })

    it('never lets the right edge come inside the viewport', () => {
      const scale = min
      const { tx } = clampTransform({ tx: -1e6, ty: 0, scale }, VW, VH, MAP_W, MAP_H, min)
      expect(tx).toBeCloseTo(VW - MAP_W * scale, 10)
    })

    it('passes an in-bounds pan through untouched', () => {
      const t = { tx: -300, ty: -200, scale: 0.5 }
      const out = clampTransform(t, VW, VH, MAP_W, MAP_H, min)
      expect(out).toEqual(t)
    })

    it('centres an axis whose scaled map is smaller than the viewport', () => {
      // Force the smaller-than-viewport branch with a tiny map.
      const out = clampTransform({ tx: 999, ty: 999, scale: 1 }, VW, VH, 400, 300, 0.01)
      expect(out.tx).toBe((VW - 400) / 2)
      expect(out.ty).toBe((VH - 300) / 2)
    })
  })

  describe('with a left inset for the desktop pane', () => {
    it('lets the left edge slide clear of the pane but no further', () => {
      const out = clampTransform({ tx: 5000, ty: 0, scale: min }, VW, VH, MAP_W, MAP_H, min, PANE)
      expect(out.tx).toBe(PANE)
    })

    it('brings Tangerang out from under the pane', () => {
      // KCI-TNG sits at world x ~232 — inside the 432px band at any real zoom.
      const tangerangX = 232
      const scale = min
      // Ask to centre it in the band left visible beside the pane.
      const wanted = PANE + (VW - PANE) / 2 - tangerangX * scale
      const { tx } = clampTransform({ tx: wanted, ty: 0, scale }, VW, VH, MAP_W, MAP_H, min, PANE)
      // Its screen x must land right of the pane, which is the whole point.
      expect(tangerangX * scale + tx).toBeGreaterThan(PANE)
    })

    it('is what today’s clamp would have refused', () => {
      // The same request with no inset pins to 0 and leaves Tangerang hidden.
      const tangerangX = 232
      const scale = min
      const wanted = PANE + (VW - PANE) / 2 - tangerangX * scale
      const { tx } = clampTransform({ tx: wanted, ty: 0, scale }, VW, VH, MAP_W, MAP_H, min)
      expect(tx).toBe(0)
      expect(tangerangX * scale + tx).toBeLessThan(PANE)
    })

    it('still clamps the right edge flush to the true viewport edge', () => {
      // Nothing covers the right, so the inset must not pull it in.
      const scale = min
      const { tx } = clampTransform({ tx: -1e6, ty: 0, scale }, VW, VH, MAP_W, MAP_H, min, PANE)
      expect(tx).toBeCloseTo(VW - MAP_W * scale, 10)
    })

    it('leaves the vertical axis alone', () => {
      const withPane = clampTransform({ tx: 0, ty: -500, scale: 0.5 }, VW, VH, MAP_W, MAP_H, min, PANE)
      const without = clampTransform({ tx: 0, ty: -500, scale: 0.5 }, VW, VH, MAP_W, MAP_H, min)
      expect(withPane.ty).toBe(without.ty)
    })

    it('centres a too-small map inside the visible band, not the whole viewport', () => {
      const out = clampTransform({ tx: 999, ty: 0, scale: 1 }, VW, VH, 400, 300, 0.01, PANE)
      expect(out.tx).toBe(PANE + (VW - PANE - 400) / 2)
      // Which is well right of where it would sit with no pane.
      expect(out.tx).toBeGreaterThan((VW - 400) / 2)
    })

    /*
     * The worst case, and the one the rider actually reported: at minimum zoom
     * the scaled map exactly fills the viewport, so with no inset there is not
     * a single pixel of pan slack and the west end is unreachable rather than
     * merely covered.
     */
    it('buys pan slack at minimum zoom, where there was none', () => {
      const scale = min
      expect(MAP_W * scale).toBeCloseTo(VW, 6)
      const pinned = clampTransform({ tx: 9999, ty: 0, scale }, VW, VH, MAP_W, MAP_H, min)
      expect(pinned.tx).toBe(0)

      const freed = clampTransform({ tx: 9999, ty: 0, scale }, VW, VH, MAP_W, MAP_H, min, PANE)
      expect(freed.tx).toBe(PANE)
      // Both western terminals clear the pane at the most zoomed-out view.
      for (const worldX of [232 /* KCI-TNG */, 334]) {
        expect(worldX * scale + freed.tx).toBeGreaterThan(PANE)
      }
    })

    it('degrades gracefully when the inset is wider than the viewport', () => {
      // Narrow desktop window: the band cannot take more than the viewport has.
      const out = clampTransform({ tx: 5000, ty: 0, scale: min }, 300, VH, MAP_W, MAP_H, min, PANE)
      expect(Number.isFinite(out.tx)).toBe(true)
      expect(out.tx).toBeLessThanOrEqual(300)
    })
  })
})
