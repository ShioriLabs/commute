import { describe, expect, it } from 'vitest'
import {
  dashSegment,
  DESKTOP_TILE_BUDGET_CEILING_BYTES,
  LOW_MEMORY_CEILING_BYTES,
  MAX_RENDER_DPR,
  MAX_TIER,
  PHONE_TILE_BUDGET_CEILING_BYTES,
  pickTier,
  renderDpr,
  ROUTE_CASING_EXTRA_WORLD,
  ROUTE_PIN_RADIUS_WORLD,
  routeDrawItems,
  tileBudgetBytes,
  hitTest,
  labelAnchorPoint,
  mapTreatment,
  markerLabelPoint,
  pointToShapeDistance,
  ringOffsetWorld,
  ROUTE_DESATURATE_MAX,
  ROUTE_FADE_MAX,
  SELECTION_DESATURATE_MAX,
  SELECTION_FADE_MAX,
  SPOTLIGHT_FEATHER_WORLD,
  RING_MAX_OFFSET_WORLD,
  RING_REST_OFFSET_WORLD,
  type Point,
  type RouteOverlay,
  type SelectionOverlay,
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

// dashSegment pre-splits transfer connectors into capsule sub-segments on the
// CPU, so the renderers draw dashes with the same program as solid segments
// and no shader dash math. The pattern is centered: margins at both ends are
// equal, so a dash never starts flush at one station and ragged at the other.

describe('dashSegment', () => {
  it('returns nothing for a zero-length segment', () => {
    expect(dashSegment(10, 20, 10, 20, 14, 10)).toEqual([])
  })

  it('covers a segment shorter than one dash with a single full-length dash', () => {
    // Two stations nearly touching: the connector is still visible, just short.
    expect(dashSegment(0, 0, 8, 0, 14, 10)).toEqual([
      { ax: 0, ay: 0, bx: 8, by: 0 }
    ])
  })

  it('lays out an exact-fit pattern with no margins', () => {
    // len 38 = 14 + 10 + 14: two dashes, one gap, flush at both ends.
    expect(dashSegment(0, 0, 38, 0, 14, 10)).toEqual([
      { ax: 0, ay: 0, bx: 14, by: 0 },
      { ax: 24, ay: 0, bx: 38, by: 0 }
    ])
  })

  it('centers the pattern when there is leftover length', () => {
    // len 42 leaves 4 over the exact-fit 38: margin 2 at each end.
    expect(dashSegment(0, 0, 42, 0, 14, 10)).toEqual([
      { ax: 2, ay: 0, bx: 16, by: 0 },
      { ax: 26, ay: 0, bx: 40, by: 0 }
    ])
  })

  it('has a centered pattern the same from either end', () => {
    const forward = dashSegment(0, 0, 42, 0, 14, 10)
    const backward = dashSegment(42, 0, 0, 0, 14, 10)
    expect(backward.map(d => ({ ax: d.bx, ay: d.by, bx: d.ax, by: d.ay })).reverse()).toEqual(forward)
  })

  it('follows the segment direction off-axis', () => {
    // 3-4-5 direction, len 50: exact fit for 14+10+14 is 38, margin 6 each end.
    const dashes = dashSegment(0, 0, 30, 40, 14, 10)
    expect(dashes).toHaveLength(2)
    const [first, second] = dashes
    expect(first.ax).toBeCloseTo(6 * 0.6)
    expect(first.ay).toBeCloseTo(6 * 0.8)
    expect(first.bx).toBeCloseTo(20 * 0.6)
    expect(first.by).toBeCloseTo(20 * 0.8)
    expect(second.ax).toBeCloseTo(30 * 0.6)
    expect(second.ay).toBeCloseTo(30 * 0.8)
    expect(second.bx).toBeCloseTo(44 * 0.6)
    expect(second.by).toBeCloseTo(44 * 0.8)
  })
})

// routeDrawItems flattens a RouteOverlay into an ordered paint list — casing
// under color under pins — that both renderers rasterize verbatim, so the two
// paths can't drift apart stylistically.

describe('routeDrawItems', () => {
  const lastIndexWhere = (items: ReturnType<typeof routeDrawItems>, pred: (item: ReturnType<typeof routeDrawItems>[number]) => boolean) => {
    for (let i = items.length - 1; i >= 0; i--) {
      if (pred(items[i])) return i
    }
    return -1
  }

  const overlay: RouteOverlay = {
    segments: [
      { ax: 0, ay: 0, bx: 100, by: 0, r: 7, color: [1, 0, 0], kind: 'ride' },
      { ax: 100, ay: 0, bx: 200, by: 0, r: 7, color: [0, 0, 1], kind: 'ride' }
    ],
    pins: [
      { x: 0, y: 0, kind: 'origin' },
      { x: 200, y: 0, kind: 'destination' }
    ]
  }

  it('paints casing for every segment before any color fill', () => {
    const items = routeDrawItems(overlay)
    const lastCasing = lastIndexWhere(items, i => i.r === 7 + ROUTE_CASING_EXTRA_WORLD)
    const firstColor = items.findIndex(i => i.color[0] === 1 && i.color[1] === 0)
    expect(lastCasing).toBeGreaterThanOrEqual(1)
    expect(firstColor).toBeGreaterThan(lastCasing)
  })

  it('paints pins last, as discs on the pin centroid', () => {
    const items = routeDrawItems(overlay)
    const discs = items.filter(i => i.ax === i.bx && i.ay === i.by)
    expect(discs.length).toBeGreaterThanOrEqual(4) // ≥ disc + inner per pin
    // Identified by the route's own half-width rather than by "not a disc":
    // the arrow glyphs inside a pin are non-degenerate capsules too, and they
    // legitimately come after everything here.
    const lastSegment = lastIndexWhere(items, i => i.r === 7 || i.r === 7 + ROUTE_CASING_EXTRA_WORLD)
    expect(items.indexOf(discs[0])).toBeGreaterThan(lastSegment)
    expect(discs.every(i => i.ax === 0 || i.ax === 200)).toBe(true)
  })

  // The ends carry a direction glyph: up where the journey starts, down where
  // it finishes. Screen y grows downward, so an up arrow's tip is the SMALLEST
  // y in the glyph — the easy thing to get backwards.
  it('points the origin arrow up and the destination arrow down', () => {
    const items = routeDrawItems(overlay)
    const glyphAt = (x: number) => items.filter(i => i.ax !== i.bx || i.ay !== i.by).filter(i => Math.abs(i.ax - x) <= 12 && Math.abs(i.bx - x) <= 12)

    const originGlyph = glyphAt(0)
    const destGlyph = glyphAt(200)
    expect(originGlyph).toHaveLength(3) // shaft + two barbs
    expect(destGlyph).toHaveLength(3)

    // The shaft is the vertical stroke; the barbs meet at its tip.
    const tipY = (glyph: typeof items, dir: 'up' | 'down') =>
      dir === 'up' ? Math.min(...glyph.flatMap(i => [i.ay, i.by])) : Math.max(...glyph.flatMap(i => [i.ay, i.by]))
    // Both barbs terminate at the tip, which is what makes it read as a point.
    const originTip = tipY(originGlyph, 'up')
    expect(originGlyph.filter(i => i.ay === originTip || i.by === originTip)).toHaveLength(3)
    const destTip = tipY(destGlyph, 'down')
    expect(destGlyph.filter(i => i.ay === destTip || i.by === destTip)).toHaveLength(3)

    // And the two glyphs are mirror images, not the same arrow twice.
    expect(originTip - 0).toBeLessThan(0)
    expect(destTip - 0).toBeGreaterThan(0)
  })

  it('keeps the pin footprint inside the bbox margin the model promises', () => {
    // Every pin item, glyph strokes included: the model pads the bbox by the
    // pin radius, so anything reaching past that would be clipped by a camera
    // fit that framed the route exactly.
    const margin = ROUTE_PIN_RADIUS_WORLD + ROUTE_CASING_EXTRA_WORLD
    for (const item of routeDrawItems(overlay)) {
      for (const [x, y] of [[item.ax, item.ay], [item.bx, item.by]] as const) {
        const nearOrigin = Math.hypot(x - 0, y - 0) <= margin
        const nearDest = Math.hypot(x - 200, y - 0) <= margin
        // Segments run between the two, so only assert on pin-local geometry.
        if (!nearOrigin && !nearDest) continue
        const cx = nearOrigin ? 0 : 200
        expect(Math.hypot(x - cx, y - 0) + item.r).toBeLessThanOrEqual(margin)
      }
    }
  })
})

/*
 * Tap resolution is tiered — station, then hub, then label — and a closer shape
 * in a lower tier never wins. The shapes genuinely overlap on this map, so the
 * order is what decides which one a tap opens.
 */
describe('hitTest', () => {
  const dot = (id: string, x: number, y: number, r = 12): Point =>
    ({ id, ax: x, ay: y, bx: x, by: y, r })

  it('prefers a station pill over the hub region containing it', () => {
    // A hub region and its member pills overlap by construction: a tap on a
    // member must open that station, and only the gaps between members open
    // the hub.
    const hub: Point = { id: 'HUB-DKA', ax: 0, ay: 0, bx: 100, by: 0, r: 60 }
    const station = dot('KCI-SUD', 50, 0)
    const hit = hitTest(50, 0, [hub, station], 0)
    expect(hit).toEqual({ kind: 'station', point: station })
  })

  it('still opens the hub in the gap between its members', () => {
    const hub: Point = { id: 'HUB-DKA', ax: 0, ay: 0, bx: 100, by: 0, r: 60 }
    const station = dot('KCI-SUD', 0, 0)
    const hit = hitTest(95, 0, [hub, station], 0)
    expect(hit).toEqual({ kind: 'hub', point: hub })
  })

  it('prefers a station pill over a label covering it', () => {
    // The reason the label tier exists: a name is far the largest shape on the
    // map and routinely covers markers belonging to other stations. Ranking by
    // distance alone would let it swallow the pill drawn on top of it — here
    // the tap is dead centre of the label and still opens the station.
    const label: Point = { id: 'LBL-KCI-SUD', station: 'KCI-SUD', ax: 0, ay: 0, bx: 200, by: 0, r: 40 }
    const other = dot('KCI-SUDB', 100, 0)
    const hit = hitTest(100, 0, [label, other], 0)
    expect(hit).toEqual({ kind: 'station', point: other })
  })

  it('prefers a hub region over a label covering it', () => {
    const label: Point = { id: 'LBL-KCI-SUD', station: 'KCI-SUD', ax: 0, ay: 0, bx: 200, by: 0, r: 40 }
    const hub: Point = { id: 'HUB-DKA', ax: 100, ay: 0, bx: 100, by: 0, r: 20 }
    const hit = hitTest(100, 0, [label, hub], 0)
    expect(hit).toEqual({ kind: 'hub', point: hub })
  })

  it('opens the label where nothing more precise is under the tap', () => {
    const label: Point = { id: 'LBL-KCI-SUD', station: 'KCI-SUD', ax: 0, ay: 0, bx: 200, by: 0, r: 40 }
    const far = dot('KCI-SUDB', 900, 900)
    const hit = hitTest(20, 0, [label, far], 0)
    expect(hit).toEqual({ kind: 'label', point: label })
  })

  it('returns null when the tap misses everything', () => {
    expect(hitTest(900, 900, [dot('KCI-SUD', 0, 0)], 0)).toBeNull()
  })
})

describe('labelAnchorPoint', () => {
  const dot = (id: string, x: number, y: number, station?: string): Point =>
    ({ id, station, ax: x, ay: y, bx: x, by: y, r: 12 })

  const label = (station: string, x: number, y: number): Point =>
    ({ id: `LBL-${station}`, station, ax: x - 60, ay: y, bx: x + 60, by: y, r: 20 })

  it('resolves a label to the marker it names', () => {
    // A name can sit hundreds of world units from its dot, so the spotlight and
    // the camera have to follow the marker rather than the text.
    const marker = dot('KCI-SUD', 500, 500)
    const other = dot('KCI-SUDB', 10, 10)
    expect(labelAnchorPoint(label('KCI-SUD', 0, 0), [marker, other])).toBe(marker)
  })

  it('picks the nearest marker when a halte is drawn twice', () => {
    // Flyover Jatinegara and Tanjung Priok each have a second shape carrying
    // the `-b` suffix; the label belongs to whichever it was extracted beside.
    const near = dot('TJ-H00037C', 40, 0)
    const far = dot('TJ-H00037C-b', 900, 0, 'TJ-H00037C')
    expect(labelAnchorPoint(label('TJ-H00037C', 0, 0), [far, near])).toBe(near)
  })

  it('ignores hub regions and other labels', () => {
    // A hub is not the station's marker, and another label is not a marker at
    // all — either would put the halo somewhere the station is not.
    const marker = dot('KCI-SUD', 300, 0)
    const hub: Point = { id: 'HUB-DKA', station: 'KCI-SUD', ax: 0, ay: 0, bx: 0, by: 0, r: 50 }
    const twin = label('KCI-SUD', 5, 0)
    expect(labelAnchorPoint(label('KCI-SUD', 0, 0), [hub, twin, marker])).toBe(marker)
  })

  it('falls back to the label when its station has no marker', () => {
    // Better a spotlight on the words than a tap that silently does nothing.
    const lbl = label('KCI-SUD', 0, 0)
    expect(labelAnchorPoint(lbl, [dot('KCI-OTHER', 10, 10)])).toBe(lbl)
  })
})

/*
 * The selection treatment: the map fades toward white everywhere except a
 * cutout around the tapped node.
 *
 * These pin the two things that are easy to break by "simplifying" later — that
 * a route and a selection combine by max() rather than summing, and that the
 * cutout rides the same feather the halo is drawn against.
 */
describe('mapTreatment', () => {
  const sel = (fadeAlpha: number): SelectionOverlay => ({
    ax: 100, ay: 100, bx: 100, by: 100, r: 20, cr: 20,
    color: [1, 0, 0], fadeAlpha, ringProgress: 1
  })
  const routeFrame = (fade: number, desaturate: number) => ({
    alpha: 1, scrimAlpha: 0, desaturate, fade
  })

  it('leaves the map alone with neither a selection nor a route', () => {
    const t = mapTreatment(null, null)
    expect(t.fade).toBe(0)
    expect(t.desaturate).toBe(0)
    // feather 0 is what disables the cutout in both renderers.
    expect(t.feather).toBe(0)
    expect(t.cuts).toHaveLength(0)
  })

  it('fades for a selection alone, and punches a cutout at its shape', () => {
    const t = mapTreatment(sel(SELECTION_FADE_MAX), null)
    expect(t.fade).toBe(SELECTION_FADE_MAX)
    expect(t.desaturate).toBeCloseTo(SELECTION_DESATURATE_MAX)
    expect(t.feather).toBe(SPOTLIGHT_FEATHER_WORLD)
    expect(t.cuts).toHaveLength(1)
    expect(t.cuts[0].ax).toBe(100)
    expect(t.cuts[0].r).toBe(20)
  })

  it('keeps fade and desaturate in proportion mid-animation', () => {
    // Scaled off the fade's progress rather than animated separately, so the
    // map does not briefly go grey before it goes pale.
    const t = mapTreatment(sel(SELECTION_FADE_MAX / 2), null)
    expect(t.desaturate).toBeCloseTo(SELECTION_DESATURATE_MAX / 2)
  })

  it('fades once, not twice, when a selection lands on a shown route', () => {
    // The trap this exists to stop: two fades toward white summing into a blank
    // page. max() also keeps the map from visibly REGAINING contrast as the
    // spotlight fades in over an already-faded route.
    const t = mapTreatment(sel(SELECTION_FADE_MAX), routeFrame(ROUTE_FADE_MAX, ROUTE_DESATURATE_MAX))
    expect(t.fade).toBe(Math.max(ROUTE_FADE_MAX, SELECTION_FADE_MAX))
    expect(t.fade).toBeLessThanOrEqual(1)
    expect(t.desaturate).toBeLessThanOrEqual(1)
  })

  it('still cuts a hole for the selection while a route is drawn', () => {
    const t = mapTreatment(sel(SELECTION_FADE_MAX), routeFrame(ROUTE_FADE_MAX, ROUTE_DESATURATE_MAX))
    expect(t.feather).toBe(SPOTLIGHT_FEATHER_WORLD)
    expect(t.cuts).toHaveLength(1)
  })

  it('cuts no hole for a route on its own', () => {
    // A route deliberately fades the whole map: its capsules are drawn at full
    // strength on top, so there is nothing to protect underneath.
    const t = mapTreatment(null, routeFrame(ROUTE_FADE_MAX, ROUTE_DESATURATE_MAX))
    expect(t.fade).toBe(ROUTE_FADE_MAX)
    expect(t.feather).toBe(0)
    expect(t.cuts).toHaveLength(0)
  })

  it('drops the cutout once the selection has faded out', () => {
    // A spotlight mid-exit at fadeAlpha 0 must not leave a hole punched in a
    // route's fade after the station is gone.
    const t = mapTreatment(sel(0), routeFrame(ROUTE_FADE_MAX, ROUTE_DESATURATE_MAX))
    expect(t.feather).toBe(0)
    expect(t.cuts).toHaveLength(0)
  })

  it('ignores a route whose overlay has not faded in yet', () => {
    const t = mapTreatment(null, { alpha: 0, scrimAlpha: 0, desaturate: 0.9, fade: 0.9 })
    expect(t.fade).toBe(0)
  })

  /*
   * Isolating a line from an open station sheet used to snap: the corridor's
   * holes were gated on `isolateFade > 0`, so they arrived at full extent on
   * the first frame of a 350ms fade. The radii now track the fade's own
   * progress, which is what makes the lit region open along the line instead
   * of appearing whole.
   */
  const isoShape = { ax: 0, ay: 0, bx: 400, by: 0, r: 20, cr: 6 }
  const iso = (fadeAlpha: number, openProgress = 1) => ({
    shapes: [isoShape], fadeAlpha, openProgress
  })

  it('fades the isolate cutout in rather than showing it whole', () => {
    // openProgress is what the holes track, NOT fadeAlpha. The two are separate
    // because the fade is seeded from whatever is already drawn (so isolating
    // over a station spotlight does not dip), which would otherwise report the
    // geometry as fully arrived on its first frame.
    const early = mapTreatment(null, null, iso(SELECTION_FADE_MAX, 0.01))
    expect(early.cuts).toHaveLength(1)
    expect(early.cuts[0].alpha).toBeCloseTo(0.01)
  })

  it('never scales the geometry — a corridor fades, it does not thin', () => {
    // Scaling r would narrow the stroke to a hairline, which reads as the line
    // shrinking rather than fading. The shape is always its true size.
    for (const pr of [0.01, 0.5, 1]) {
      const c = mapTreatment(null, null, iso(SELECTION_FADE_MAX, pr)).cuts[0]
      expect(c.r).toBe(isoShape.r)
      expect(c.cr).toBe(isoShape.cr)
    }
  })

  it('raises the isolate alpha monotonically with its open progress', () => {
    const alphas = [0.2, 0.5, 0.8, 1].map(
      pr => mapTreatment(null, null, iso(SELECTION_FADE_MAX, pr)).cuts[0].alpha ?? 1
    )
    for (let i = 1; i < alphas.length; i++) {
      expect(alphas[i]).toBeGreaterThan(alphas[i - 1])
    }
  })

  it('starts transparent even when the fade starts at full strength', () => {
    // The exact station -> line case: the map is already dimmed for the
    // station, so the isolate inherits that fade and only the alpha moves.
    const t = mapTreatment(sel(SELECTION_FADE_MAX), null, iso(SELECTION_FADE_MAX, 0))
    const line = t.cuts.find(c => c.bx === 400)
    expect(line?.alpha).toBe(0)
  })

  it('reaches full strength once the isolate is fully in', () => {
    const t = mapTreatment(null, null, iso(SELECTION_FADE_MAX, 1))
    expect(t.cuts[0].alpha).toBeCloseTo(1)
    expect(t.cuts[0].ax).toBe(isoShape.ax)
    expect(t.cuts[0].bx).toBe(isoShape.bx)
  })

  it('still drops the isolate entirely at zero fade', () => {
    expect(mapTreatment(null, null, iso(0)).cuts).toHaveLength(0)
  })

  /*
   * Switching lines: the outgoing corridor closes while the incoming one opens,
   * so the two cross rather than the first vanishing on the frame the second
   * appears. Both ride in the same overlay because the cut mask unions
   * overlapping shapes — a stop on both lines stays lit throughout.
   */
  const outShape = { ax: 0, ay: 200, bx: 400, by: 200, r: 20, cr: 6 }

  it('draws the outgoing line alongside the incoming one', () => {
    const t = mapTreatment(null, null, {
      shapes: [isoShape], fadeAlpha: SELECTION_FADE_MAX, openProgress: 0.3,
      closing: { shapes: [outShape], openProgress: 0.7 }
    })
    expect(t.cuts).toHaveLength(2)
  })

  it('fades the outgoing line down as the incoming one comes up', () => {
    const at = (openProgress: number, closingProgress: number) => mapTreatment(null, null, {
      shapes: [isoShape], fadeAlpha: SELECTION_FADE_MAX, openProgress,
      closing: { shapes: [outShape], openProgress: closingProgress }
    })
    const early = at(0.2, 0.8)
    const late = at(0.8, 0.2)
    const incoming = (t: ReturnType<typeof at>) => t.cuts.find(c => c.ay === 0)!.alpha ?? 1
    const outgoing = (t: ReturnType<typeof at>) => t.cuts.find(c => c.ay === 200)!.alpha ?? 1
    expect(incoming(late)).toBeGreaterThan(incoming(early))
    expect(outgoing(late)).toBeLessThan(outgoing(early))
    // Both keep their true width the whole way across.
    expect(late.cuts.every(c => c.r === 20)).toBe(true)
  })

  it('drops the outgoing line once it has closed', () => {
    const t = mapTreatment(null, null, {
      shapes: [isoShape], fadeAlpha: SELECTION_FADE_MAX, openProgress: 1,
      closing: { shapes: [outShape], openProgress: 0 }
    })
    expect(t.cuts).toHaveLength(1)
    expect(t.cuts[0].ay).toBe(0)
  })

  it('needs no closing set for a plain isolate', () => {
    expect(mapTreatment(null, null, iso(SELECTION_FADE_MAX, 1)).cuts).toHaveLength(1)
  })

  it('keeps a selection cutout at full size while an isolate grows', () => {
    // The station halo is already at rest; only the line is arriving. Scaling
    // both would shrink the halo the rider is looking at.
    const t = mapTreatment(sel(SELECTION_FADE_MAX), null, iso(SELECTION_FADE_MAX, 0.1))
    const halo = t.cuts.find(c => c.ax === 100 && c.ay === 100)
    expect(halo?.r).toBe(20)
  })

  /*
   * The mirror of the isolate case. Selecting a station while a line is
   * isolated inherits that fade, so the halo has to open on its own progress
   * or it appears at full size against dimming that never changes.
   */
  it('fades the selection cutout in rather than showing it whole', () => {
    const early = mapTreatment(
      { ...sel(SELECTION_FADE_MAX), openProgress: 0.01 }, null
    )
    expect(early.cuts).toHaveLength(1)
    expect(early.cuts[0].alpha).toBeCloseTo(0.01)
    // Full size throughout — a halo that grew would read as the marker
    // inflating rather than the highlight arriving.
    expect(early.cuts[0].r).toBe(20)
  })

  it('raises the selection alpha monotonically with its open progress', () => {
    const alphas = [0.2, 0.5, 0.8, 1].map(
      pr => mapTreatment({ ...sel(SELECTION_FADE_MAX), openProgress: pr }, null).cuts[0].alpha ?? 1
    )
    for (let i = 1; i < alphas.length; i++) {
      expect(alphas[i]).toBeGreaterThan(alphas[i - 1])
    }
  })

  it('starts the selection transparent even when the fade is already up', () => {
    // The exact line -> station case: the map is already dimmed for the line.
    const t = mapTreatment(
      { ...sel(SELECTION_FADE_MAX), openProgress: 0 }, null,
      iso(SELECTION_FADE_MAX, 1)
    )
    const halo = t.cuts.find(c => c.ax === 100 && c.ay === 100)
    expect(halo?.alpha).toBe(0)
  })

  it('fades a selection label alongside its marker', () => {
    const withLabelAt = (openProgress: number) => mapTreatment({
      ...sel(SELECTION_FADE_MAX),
      openProgress,
      label: { ax: 300, ay: 0, bx: 360, by: 0, r: 12, cr: 4 }
    }, null)
    const half = withLabelAt(0.5).cuts.find(c => c.ax === 300)
    expect(half?.alpha).toBeCloseTo(0.5)
    expect(half?.r).toBe(12)
    const done = withLabelAt(1).cuts.find(c => c.ax === 300)
    expect(done?.alpha).toBeCloseTo(1)
  })

  it('defaults a selection with no openProgress to fully opaque', () => {
    // Back-compat: a caller that never sets it keeps the old behaviour.
    const c = mapTreatment(sel(SELECTION_FADE_MAX), null).cuts[0]
    expect(c.alpha ?? 1).toBe(1)
    expect(c.r).toBe(20)
  })
})

/*
 * The cutout mask and the halo are drawn from one boundary — the GLSL shader
 * and pointToShapeDistance are the same rounded-rect SDF. These assert the mask
 * the shader computes over that distance, so a change to the feather cannot
 * silently move the node's edge away from the ring drawn around it.
 */
describe('selection cutout mask', () => {
  const p: Point = { id: 'KCI-SUD', ax: 100, ay: 100, bx: 100, by: 100, r: 20 }
  // The smoothstep(0, feather, d) the tile shader applies: 0 keeps the artwork
  // at full strength, 1 lets the fade through.
  const keep = (x: number, y: number) => {
    const d = pointToShapeDistance(x, y, p)
    const t = Math.max(0, Math.min(1, d / SPOTLIGHT_FEATHER_WORLD))
    return t * t * (3 - 2 * t)
  }

  it('holds the node at full strength at its centre', () => {
    expect(keep(100, 100)).toBe(0)
  })

  it('still holds it at the shape edge', () => {
    // Inside the shape the distance is negative, so the node never picks up any
    // of the fade regardless of how far in it is.
    expect(keep(119, 100)).toBe(0)
  })

  it('lets the fade through fully past the feather', () => {
    expect(keep(100 + 20 + SPOTLIGHT_FEATHER_WORLD + 1, 100)).toBe(1)
  })

  it('ramps rather than stepping across the feather', () => {
    const mid = keep(100 + 20 + SPOTLIGHT_FEATHER_WORLD / 2, 100)
    expect(mid).toBeGreaterThan(0)
    expect(mid).toBeLessThan(1)
  })
})

// The halo settles from outside the shape onto its edge. Pinned because the
// cutout work sits on the same constants and a collateral edit here would
// detach the ring from the node it marks.
describe('ringOffsetWorld', () => {
  it('starts wide and settles in', () => {
    expect(ringOffsetWorld(0)).toBe(RING_MAX_OFFSET_WORLD)
    expect(ringOffsetWorld(1)).toBe(RING_REST_OFFSET_WORLD)
    expect(ringOffsetWorld(0.5)).toBeLessThan(RING_MAX_OFFSET_WORLD)
    expect(ringOffsetWorld(0.5)).toBeGreaterThan(RING_REST_OFFSET_WORLD)
  })
})

/*
 * The station's name, cleared alongside its dot. The mirror of
 * labelAnchorPoint, and it has to agree with it: a tap on a name resolves to
 * the marker, and that marker must resolve back to the same name.
 */
describe('markerLabelPoint', () => {
  const dot = (id: string, x: number, y: number, station?: string): Point =>
    ({ id, station, ax: x, ay: y, bx: x, by: y, r: 12 })
  const label = (station: string, x: number, y: number, id?: string): Point =>
    ({ id: id ?? `LBL-${station}`, station, ax: x, ay: y, bx: x + 60, by: y, r: 20, noRing: true })

  it('finds the label naming a marker', () => {
    const marker = dot('KCI-SUD', 0, 0)
    const lbl = label('KCI-SUD', 100, 0)
    expect(markerLabelPoint(marker, [marker, lbl])).toBe(lbl)
  })

  it('returns null when the station has no name drawn', () => {
    // Five points have none — four display-only hubs and KCI-BST. The cutout is
    // then just the marker, which is the pre-existing behaviour.
    const marker = dot('KCI-BST', 0, 0)
    expect(markerLabelPoint(marker, [marker, label('KCI-SUD', 100, 0)])).toBeNull()
  })

  it('picks the nearest label when a station carries two', () => {
    const marker = dot('KCI-SUD', 0, 0)
    const near = label('KCI-SUD', 80, 0, 'LBL-KCI-SUD')
    const far = label('KCI-SUD', 900, 0, 'LBL-KCI-SUD-b')
    expect(markerLabelPoint(marker, [far, near, marker])).toBe(near)
  })

  it('resolves the twin drawn beside a duplicated halte', () => {
    // A halte drawn twice carries a `-b` marker; each should take the label it
    // was extracted beside, not the other one's.
    const a = dot('TJ-H00037C', 0, 0)
    const b = dot('TJ-H00037C-b', 900, 0, 'TJ-H00037C')
    const la = label('TJ-H00037C', 60, 0, 'LBL-TJ-H00037C')
    const lb = label('TJ-H00037C', 960, 0, 'LBL-TJ-H00037C-b')
    expect(markerLabelPoint(a, [a, b, la, lb])).toBe(la)
    expect(markerLabelPoint(b, [a, b, la, lb])).toBe(lb)
  })

  it('never returns a label for a label', () => {
    // Guards the fallback path: a label standing in for itself must not then
    // resolve a second cutout onto its own words.
    const lbl = label('KCI-SUD', 0, 0)
    expect(markerLabelPoint(lbl, [lbl])).toBeNull()
  })

  it('round-trips with labelAnchorPoint', () => {
    // The two must agree, or a tap on a name would clear a different name.
    const marker = dot('KCI-SUD', 0, 0)
    const lbl = label('KCI-SUD', 120, 0)
    const points = [marker, lbl]
    expect(labelAnchorPoint(lbl, points)).toBe(marker)
    expect(markerLabelPoint(marker, points)).toBe(lbl)
  })
})

// The label rides through mapTreatment as a SECOND hole, never merged into the
// marker's — a single shape spanning both would clear the map between them.
describe('mapTreatment label cutout', () => {
  const withLabel = (label: SelectionOverlay['label']): SelectionOverlay => ({
    ax: 0, ay: 0, bx: 0, by: 0, r: 12, cr: 12,
    color: [1, 0, 0], fadeAlpha: SELECTION_FADE_MAX, ringProgress: 1, label
  })

  it('carries the label as its own shape', () => {
    const t = mapTreatment(withLabel({ ax: 200, ay: 0, bx: 260, by: 0, r: 20, cr: 6 }), null)
    expect(t.cuts).toHaveLength(2)
    // Geometry matched field by field rather than as a whole object: cuts also
    // carry an alpha now, and this assertion is about the label's shape.
    expect(t.cuts).toContainEqual(
      expect.objectContaining({ ax: 200, ay: 0, bx: 260, by: 0, r: 20, cr: 6 })
    )
    // The marker's own cutout is untouched by the label's presence.
    expect(t.cuts.find(c => c.r === 12)).toBeDefined()
  })

  it('has no label cutout when the station has no name drawn', () => {
    expect(mapTreatment(withLabel(null), null).cuts).toHaveLength(1)
  })

  it('drops the label cutout once the selection has faded out', () => {
    const sel = withLabel({ ax: 200, ay: 0, bx: 260, by: 0, r: 20, cr: 6 })
    expect(mapTreatment({ ...sel, fadeAlpha: 0 }, null).cuts).toHaveLength(0)
  })
})
