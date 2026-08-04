import { describe, expect, it } from 'vitest'
import {
  DESKTOP_TILE_BUDGET_CEILING_BYTES,
  LOW_MEMORY_CEILING_BYTES,
  MAX_RENDER_DPR,
  MAX_TIER,
  PHONE_TILE_BUDGET_CEILING_BYTES,
  pickTier,
  renderDpr,
  tileBudgetBytes,
  type Tier
} from './map-renderer'

// pickTier decides how many texels the GPU holds per drawn pixel, so it is the
// lever on tile memory: one tier step is a 4x change in bytes per tile. These
// tests pin the boundaries, especially the half-res tier that serves the
// zoomed-out band where the whole grid is resident at once.

describe('pickTier', () => {
  it('serves the zoomed-out band from the half-res tier', () => {
    // A 360px 3x-DPR phone between the preview handoff and ~4x zoom sits at
    // scale*dpr ~0.14-0.45. Full-size tiles there are minified 2.2-7x, so the
    // half-res texture still supplies more texels than the screen shows.
    // currentTier is 2 (zooming back out), not 0.5: passing the expected answer
    // in as the current tier lets the hysteresis branch return it unchanged, so
    // the assertion would hold even if the tier floor were still 1.
    for (const target of [0.142, 0.2, 0.284, 0.4, 0.454]) {
      expect(pickTier(target / 3, 3, 2)).toBe(0.5)
    }
  })

  it('promotes to tier 1 once half-res would be under-sampled', () => {
    // Past 0.5 texels per pixel the half-res tile is genuinely too coarse.
    expect(pickTier(0.6 / 3, 3, 0.5)).toBe(1)
    expect(pickTier(1 / 3, 3, 0.5)).toBe(1)
  })

  it('promotes to tier 2 past 1:1', () => {
    expect(pickTier(1.5 / 3, 3, 1)).toBe(2)
    expect(pickTier(2 / 3, 3, 1)).toBe(2)
  })

  it('never returns a tier below the half-res floor, however far out the view is', () => {
    // Fit-to-screen is ~0.11 on a phone, and the map can be pinched smaller
    // still. There is no tier below 0.5 to fall back to.
    // Asserts the literal 0.5, not MIN_TIER: comparing the function against the
    // same constant it reads would pass even if the floor regressed. Likewise
    // currentTier is 2 so hysteresis can't stand in for the floor.
    for (const target of [0.11, 0.05, 0.001]) {
      expect(pickTier(target / 3, 3, 2)).toBe(0.5)
    }
  })

  it('honours the maxTier cap', () => {
    // Small viewports and low-core devices cap at 2; canvas2d caps at 1.
    expect(pickTier(4 / 3, 3, 1, 2)).toBe(2)
    expect(pickTier(4 / 3, 3, 1, 1)).toBe(1)
    expect(pickTier(4 / 3, 3, 1, MAX_TIER)).toBe(4)
  })

  it('holds the current tier just past a boundary rather than flapping', () => {
    // Hysteresis: a pinch hovering on the threshold must not thrash between
    // tiers, since every flip is a fetch, decode and upload.
    expect(pickTier(1.05 / 3, 3, 1)).toBe(1)
    // Comfortably past it, the upgrade goes through.
    expect(pickTier(1.5 / 3, 3, 1)).toBe(2)
  })

  it('downgrades immediately when zooming back out', () => {
    // No hysteresis on the way down — holding a finer tier than the view needs
    // is exactly the leak that pinned tiles at tier 2 after a zoom-out.
    expect(pickTier(0.2 / 3, 3, 2)).toBe(0.5)
    expect(pickTier(0.8 / 3, 3, 2)).toBe(1)
  })

  it('only ever returns a declared tier', () => {
    const allowed: Tier[] = [0.5, 1, 2, 4]
    for (let t = 0.01; t < 8; t += 0.01) {
      expect(allowed).toContain(pickTier(t / 3, 3, 1, MAX_TIER))
    }
  })
})

describe('tileBudgetBytes', () => {
  const TIER2_TILE = Math.round(2378 * 1682 * 2 * (4 / 3)) // ~10.7 MB, RGB565 + mips

  it('never falls below what is currently on screen', () => {
    // evictTiles refuses to drop visible tiles, so a budget under the working
    // set is not a tighter policy — it is a sweep that finds nothing droppable
    // and overshoots silently. The floor makes the number honest.
    const budget = tileBudgetBytes({
      visibleTiles: 8,
      tileBytes: TIER2_TILE,
      ceilingBytes: 16 * 1024 * 1024
    })
    expect(budget).toBe(8 * TIER2_TILE)
  })

  it('keeps about one extra screen of pan-back history', () => {
    const budget = tileBudgetBytes({
      visibleTiles: 6,
      tileBytes: TIER2_TILE,
      ceilingBytes: PHONE_TILE_BUDGET_CEILING_BYTES
    })
    expect(budget).toBe(12 * TIER2_TILE)
    expect(budget).toBeLessThan(PHONE_TILE_BUDGET_CEILING_BYTES)
  })

  it('clamps to the device ceiling', () => {
    const budget = tileBudgetBytes({
      visibleTiles: 8,
      tileBytes: TIER2_TILE,
      ceilingBytes: PHONE_TILE_BUDGET_CEILING_BYTES
    })
    expect(budget).toBe(PHONE_TILE_BUDGET_CEILING_BYTES)
  })

  it('lets deviceMemory tighten the ceiling but never raise it', () => {
    const args = { visibleTiles: 8, tileBytes: TIER2_TILE }
    const lowRam = tileBudgetBytes({
      ...args,
      ceilingBytes: DESKTOP_TILE_BUDGET_CEILING_BYTES,
      deviceMemoryGb: 4
    })
    expect(lowRam).toBe(LOW_MEMORY_CEILING_BYTES)

    // A generous deviceMemory must not lift a phone ceiling: the signal is
    // quantised, capped at 8 and absent on iOS, so it cannot support inventing
    // headroom.
    const plentyOfRam = tileBudgetBytes({
      ...args,
      ceilingBytes: PHONE_TILE_BUDGET_CEILING_BYTES,
      deviceMemoryGb: 8
    })
    expect(plentyOfRam).toBe(PHONE_TILE_BUDGET_CEILING_BYTES)
  })

  it('gives a tier-4 desktop working set room the old flat cap did not', () => {
    // Tier 4 tiles take the runtime SVG path, keep their alpha and upload as
    // RGBA: ~85 MB each. Four visible is ~341 MB, which the retired 192 MB
    // constant could only overshoot.
    const tier4Tile = Math.round(4757 * 3363 * 4 * (4 / 3))
    const budget = tileBudgetBytes({
      visibleTiles: 4,
      tileBytes: tier4Tile,
      ceilingBytes: DESKTOP_TILE_BUDGET_CEILING_BYTES
    })
    expect(budget).toBeGreaterThanOrEqual(4 * tier4Tile)
    expect(budget).toBeLessThanOrEqual(DESKTOP_TILE_BUDGET_CEILING_BYTES)
  })
})

describe('renderDpr', () => {
  it('caps above the ceiling and passes lower ratios through', () => {
    expect(renderDpr(1)).toBe(1)
    expect(renderDpr(1.5)).toBe(1.5)
    expect(renderDpr(2)).toBe(2)
    expect(renderDpr(2.625)).toBe(MAX_RENDER_DPR)
    expect(renderDpr(3)).toBe(MAX_RENDER_DPR)
    expect(renderDpr(4)).toBe(MAX_RENDER_DPR)
  })

  it('falls back to 1 for values a browser should never report', () => {
    // resize() multiplies the canvas backing store by this, so a 0 or NaN here
    // is a zero-sized (or invalid) drawing buffer, not merely a soft map.
    expect(renderDpr(0)).toBe(1)
    expect(renderDpr(-2)).toBe(1)
    expect(renderDpr(NaN)).toBe(1)
    // Infinity is nonsense rather than "very sharp", so it takes the same
    // conservative fallback as NaN instead of clamping to the ceiling.
    expect(renderDpr(Infinity)).toBe(1)
    expect(renderDpr(undefined)).toBe(1)
  })

  it('drops the 0.333-0.5 scale band from tier 2 to tier 1', () => {
    // The memory win that pays for the clamp: at dpr 3 this band resolves to
    // tier 2 (10.7 MB/tile), at the clamped dpr to tier 1 (2.67 MB/tile).
    // currentTier 2 so the hysteresis branch can't mask a downgrade.
    expect(pickTier(0.4, 3, 2, 2)).toBe(2)
    expect(pickTier(0.4, renderDpr(3), 2, 2)).toBe(1)
  })
})
