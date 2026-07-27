import { describe, expect, it } from 'vitest'
import { MAX_TIER, pickTier, type Tier } from './map-renderer'

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
