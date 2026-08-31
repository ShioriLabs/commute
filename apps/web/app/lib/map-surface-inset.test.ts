import { describe, expect, it } from 'vitest'
import { surfaceInset, type SurfaceInsetInput } from './map-surface-inset'

/*
 * The inset decides where a fitted route lands. Getting it wrong is quiet — the
 * route still draws, just partly underneath the sheet or behind the desktop pane
 * — which is exactly why it lives in a pure function with tests rather than
 * inline in the rAF tick.
 */

// Mirrors the real constants: SIDE_PANE_OCCUPIED_PX, PEEK_FRACTION, and the
// map's CHIP_CLEARANCE_PX.
const base: SurfaceInsetInput = {
  isDesktop: false,
  surfaceOpen: false,
  hasPair: false,
  viewportH: 800,
  panePx: 432,
  peekFraction: 0.3,
  chipPx: 88
}

describe('surfaceInset', () => {
  it('takes a left band for an open desktop pane and nothing off the bottom', () => {
    expect(surfaceInset({ ...base, isDesktop: true, surfaceOpen: true }))
      .toEqual({ left: 432, top: 0, bottom: 0 })
  })

  it('takes nothing on desktop with no surface open', () => {
    // The rail's pill sits in this column too, but it is one control with the
    // map legible underneath it — not a reason to give up the band.
    expect(surfaceInset({ ...base, isDesktop: true, surfaceOpen: false, hasPair: true }))
      .toEqual({ left: 0, top: 0, bottom: 0 })
  })

  it('never reserves chip clearance on desktop, where the chip does not render', () => {
    expect(surfaceInset({ ...base, isDesktop: true, hasPair: true }).bottom).toBe(0)
  })

  it('reserves the rail card height off the top on desktop', () => {
    // A fitted route centred in the whole viewport puts its northern leg under
    // the card; the card's own height is what moves it clear.
    expect(surfaceInset({ ...base, isDesktop: true, railCardPx: 198 }))
      .toEqual({ left: 0, top: 198, bottom: 0 })
  })

  it('reserves nothing at the top for a bare pill', () => {
    // The map stays readable under a single pill, so only a grown card is worth
    // moving the map for.
    expect(surfaceInset({ ...base, isDesktop: true, railCardPx: 0 }).top).toBe(0)
  })

  it('takes the card off the top and the pane off the left together', () => {
    expect(surfaceInset({ ...base, isDesktop: true, surfaceOpen: true, railCardPx: 198 }))
      .toEqual({ left: 432, top: 198, bottom: 0 })
  })

  it('ignores the rail card on a phone, which has no rail', () => {
    expect(surfaceInset({ ...base, railCardPx: 198 }).top).toBe(0)
  })

  it('takes the peek height off the bottom for an open sheet on a phone', () => {
    expect(surfaceInset({ ...base, surfaceOpen: true }))
      .toEqual({ left: 0, top: 0, bottom: 240 })
  })

  it('uses peek height regardless of how far the sheet was actually dragged', () => {
    // BottomSheet never reports its snap upward, and fitting a route into the
    // sliver above a full sheet would be pointless — so peek is the only
    // sensible assumption, and it must not depend on viewport quirks.
    expect(surfaceInset({ ...base, surfaceOpen: true, viewportH: 812 }).bottom)
      .toBe(Math.round(812 * 0.3))
  })

  it('reserves chip clearance when a pair is drawn and no sheet is open', () => {
    expect(surfaceInset({ ...base, hasPair: true }))
      .toEqual({ left: 0, top: 0, bottom: 88 })
  })

  it('reserves nothing when there is neither a pair nor a surface', () => {
    expect(surfaceInset(base)).toEqual({ left: 0, top: 0, bottom: 0 })
  })

  it('does not stack the sheet and the chip', () => {
    // The map hides the chip while a sheet is open, so counting both would push
    // the route up off the top of the viewport.
    const both = surfaceInset({ ...base, surfaceOpen: true, hasPair: true })
    expect(both.bottom).toBe(240)
  })
})
