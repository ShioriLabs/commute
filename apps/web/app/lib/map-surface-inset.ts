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
  /*
   * Height the desktop rail's column currently occupies, measured by the column
   * itself. Zero while it is a bare pill — a route fitted under a pill is still
   * readable, so only a grown column is worth moving the map for.
   */
  railCardPx?: number
}

export interface SurfaceInset {
  left: number
  /*
   * Screen the desktop rail's column takes off the TOP.
   *
   * Only while there is no route drawn — see the desktop branch. Zero on
   * phones, on a bare pill, and once a pair turns the column into a left band.
   */
  top: number
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
  chipPx,
  railCardPx = 0
}: SurfaceInsetInput): SurfaceInset {
  if (isDesktop) {
    /*
     * A drawn route is what turns the column into a left band.
     *
     * With no pair the column is a pill, or a pill plus the fields being
     * filled: a top-left object with map legible beside and below it. Reserving
     * the whole band for that would give up a quarter of the viewport to clear
     * something a couple of hundred pixels tall, so it takes a TOP inset of its
     * own height instead. Without it a fitted route centres in the whole
     * viewport and the column lands on its northern leg.
     *
     * With a pair the column carries the endpoints, the criteria, the router,
     * the fare and a trip card that runs to a timeline or a list of options —
     * and it is showing them for the very route being fitted. It occupies the
     * left edge exactly as the side pane used to, so it takes the pane's inset:
     * the column has replaced the pane on this side of the map and reserves the
     * same screen. Keyed on the pair rather than on a measured height because
     * the pair is the thing that decides it — a column mid-refetch or with the
     * trip card collapsed is still the surface describing this route, and the
     * map should not shuffle sideways every time it changes size.
     *
     * The larger of the two when a pane is also open: they occupy the same band
     * rather than stacking, so the map only has to clear it once.
     *
     * Neither ever covers the bottom, so the chip needs no clearance there.
     */
    const railLeft = hasPair ? panePx : 0
    return {
      left: Math.max(surfaceOpen ? panePx : 0, railLeft),
      top: hasPair ? 0 : railCardPx,
      bottom: 0
    }
  }
  if (surfaceOpen) return { left: 0, top: 0, bottom: Math.round(viewportH * peekFraction) }
  return { left: 0, top: 0, bottom: hasPair ? chipPx : 0 }
}
