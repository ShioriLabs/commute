// The map's detail surfaces and the rule that only one of them is ever open.
//
// Station, hub, line and fare all render as DetailSurfaces on the same layer,
// so two open at once means two cards stacked on desktop, or two independently
// draggable sheets on a phone. That rule used to live as hand-written clears
// spread across the tap handlers — each site nulling the *other* selections it
// happened to remember. Adding the line sheet as a fourth surface missed three
// of those sites, which is how tapping a corridor and then a station left both
// cards on screen.
//
// Extracted as pure state transitions for the same reason map-surface-inset.ts
// was: the suite is node-only with no DOM, so a rule that lives inside the
// route component cannot be tested at all. Here the invariant is enforced by
// construction — every opening builds a fresh state with exactly one surface
// live, so a fifth surface cannot be half-added the way the fourth was.

export interface StationSelection {
  operator: string
  code: string
}

export interface FareSelection {
  snap: 'peek' | 'full'
  /** Bumped on every opening: MapFareSheet is keyed on it, so a fresh id is
   *  what remounts the sheet rather than reusing the previous drag state. */
  id: number
}

export interface DetailSurfaceState {
  station: StationSelection | null
  hubSlug: string | null
  lineKey: string | null
  fare: FareSelection | null
}

export const NO_DETAIL_SURFACE: DetailSurfaceState = {
  station: null,
  hubSlug: null,
  lineKey: null,
  fare: null
}

/** Which surface to open. One variant per surface, so adding a fifth is a
 *  compile error everywhere it has to be handled rather than a silent omission. */
export type OpenSurface =
  | { kind: 'station', station: StationSelection }
  | { kind: 'hub', hubSlug: string }
  | { kind: 'line', lineKey: string }
  | { kind: 'fare', snap: 'peek' | 'full' }

/**
 * Open one surface, closing whatever else was open.
 *
 * Builds from {@link NO_DETAIL_SURFACE} rather than spreading `state`: the
 * whole point is that the caller cannot forget to clear a sibling, and
 * spreading would quietly carry one through.
 */
export function openSurface(state: DetailSurfaceState, open: OpenSurface): DetailSurfaceState {
  switch (open.kind) {
    case 'station':
      return { ...NO_DETAIL_SURFACE, station: open.station }
    case 'hub':
      return { ...NO_DETAIL_SURFACE, hubSlug: open.hubSlug }
    case 'line':
      return { ...NO_DETAIL_SURFACE, lineKey: open.lineKey }
    case 'fare':
      return {
        ...NO_DETAIL_SURFACE,
        fare: { snap: open.snap, id: (state.fare?.id ?? 0) + 1 }
      }
  }
}

/**
 * Whether any detail surface is open.
 *
 * Drives the desktop title pill, which sits in the corner a side pane covers.
 * The line sheet was missing from the hand-written version of this check, so
 * the pill stayed visible underneath an open line card.
 */
export function isSurfaceOpen(state: DetailSurfaceState): boolean {
  return !!(state.station || state.hubSlug || state.lineKey || state.fare)
}
