// Screen the map's chrome takes away from the usable viewport, so a fitted
// route lands where the rider can actually see it.
//
// Extracted as a pure function because the fit-bounds flight runs inside the
// rAF tick, which reads refs and never React state — the route component
// mirrors this result into a ref. Keeping the branch here also makes it
// testable, which the sheet components themselves are not (the suite is
// node-only, with no DOM).

export interface SurfaceInsetInput {
  // Desktop renders the detail surface as a side pane; phones as a bottom sheet.
  isDesktop: boolean
  // Whether any detail surface (station, hub, or fare) is open.
  surfaceOpen: boolean
  // Whether a fare pair is set, which is when the floating chip shows.
  hasPair: boolean
  viewportH: number
  // Horizontal band a desktop side pane occupies (SIDE_PANE_OCCUPIED_PX).
  panePx: number
  // Fraction of viewport height a peeked bottom sheet occupies (PEEK_FRACTION).
  peekFraction: number
  // Vertical room the floating fare chip needs when no surface is open.
  chipPx: number
}

export interface SurfaceInset {
  left: number
  bottom: number
}

/*
 * Peek height regardless of the sheet's actual snap: BottomSheet does not report
 * its snap upward, and fitting a route into the sliver above a *full* sheet
 * would be meaningless anyway.
 *
 * An open surface supersedes the chip rather than adding to it — the map route
 * hides the chip while a sheet is open, so counting both would push the route
 * off the top.
 */
export function surfaceInset({
  isDesktop,
  surfaceOpen,
  hasPair,
  viewportH,
  panePx,
  peekFraction,
  chipPx
}: SurfaceInsetInput): SurfaceInset {
  if (isDesktop) {
    /*
     * Keyed on the pane, not on the rail's pill above it. The pill is a single
     * control at the top of the column, so the map stays legible under it and
     * reserving the whole band for it would give up a quarter of the viewport
     * to hold one pill clear.
     *
     * The pane is a left band and never covers the bottom, so the chip needs no
     * clearance there.
     */
    return { left: surfaceOpen ? panePx : 0, bottom: 0 }
  }
  if (surfaceOpen) return { left: 0, bottom: Math.round(viewportH * peekFraction) }
  return { left: 0, bottom: hasPair ? chipPx : 0 }
}
