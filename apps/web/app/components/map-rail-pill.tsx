import { useLayoutEffect, useRef, useState } from 'react'
import { ArrowDownIcon, MagnifyingGlassIcon, XIcon } from '@phosphor-icons/react'
import clsx from 'clsx'
import type { FareResult } from '@commute/schemas'
import { useReducedMotion } from '~/hooks/reduced-motion'
import LineRoundel from './line-roundel'
import StationSearchList from './fare-sheet/station-search-list'
import type { PickableStation } from './fare-sheet/pickable-station'
import FareSummary from './fare-summary'

interface MapRailPillProps {
  /*
   * The drawn pair's two ends, or nulls while the fare query is still resolving
   * them. A pair is what switches this from the idle pill to the route card.
   *
   * The resolved stations rather than bare names, so each row can be signed
   * with its line's roundel the way the rest of the fare UI signs a stop.
   */
  endpoints: { from: PickableStation | null, to: PickableStation | null }
  hasPair: boolean
  // The selected journey's total, not necessarily the response's — see
  // FareSummary.
  fare: Pick<FareResult, 'totalFare' | 'transferCount'> | null
  hasError: boolean
  isLoading: boolean
  /*
   * Which endpoint the rider is currently filling, or null when the card is at
   * rest. The map owns this because the same flag arms map-tapping — picking a
   * station on the map and picking one from this list are two ways to answer
   * one question, so they cannot be two pieces of state.
   */
  picking: 'from' | 'to' | null
  onPick: (field: 'from' | 'to') => void
  onCancelPick: () => void
  // The searchable set the inline list ranks. Empty until the index arrives.
  stations: PickableStation[]
  onSelectStation: (field: 'from' | 'to', station: PickableStation) => void
  onOpenFare: () => void
  onClear: () => void
}

// The collapsed head's own height. The margins around it live in the rail's
// wrapper; together they make up RAIL_PILL_RESERVED_PX (12 + 52 + 12 = 76),
// which is where the pane docks.
const PILL_HEIGHT_PX = 52

/*
 * Shared by both states so the card reads as the pill having grown rather than
 * as a different object replacing it.
 *
 * Translucent while it is a pill or a short route card — that reads as glass
 * over the map, matching the rest of the map's floating chrome. It turns opaque
 * for the search list, which is tall enough that the artwork behind it competes
 * with the station names for legibility. See SEARCH_SURFACE_CLASS.
 */
const SURFACE_CLASS = 'rounded-2xl bg-white/90 backdrop-blur shadow-lg'
const SEARCH_SURFACE_CLASS = 'rounded-2xl bg-white shadow-lg'

// The mark column both stops and the arrow between them share. Fixed rather
// than intrinsic so the two names start on the same x whether a row shows a
// roundel or the placeholder dot, and so the arrow can centre on it.
const ROUNDEL_COL = 'w-6 shrink-0'

/*
 * One end of the drawn pair.
 *
 * Signed with the line's roundel rather than the station's own number: the fare
 * response carries no station numbers (there is no `fromNumber`/`toNumber` on
 * the wire), and PickableStation resolves lines, not positions. The line
 * roundel is what the rest of the fare UI — the route bar, the result card —
 * uses to sign a stop, so this stays consistent with them rather than inventing
 * a second vocabulary. A true M07-style station roundel needs the API to send
 * the number first.
 *
 * An interchange carries several lines; the first in display order stands for
 * the stop, because the row names one station and a row of roundels would
 * compete with the name for the width.
 */
function EndpointRow({ station, placeholder, emphasis = false, armed, enabled, onClick }: {
  station: PickableStation | null
  placeholder: string
  emphasis?: boolean
  // This field is the one being filled: it reads as selected, and the map is
  // armed to answer a tap with it.
  armed: boolean
  // The card is open. Rows stay mounted while it is closed so the collapse can
  // animate, and a control inside a zero-height box must not be reachable.
  enabled: boolean
  onClick: () => void
}) {
  const line = station?.sortedLines[0]
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        tabIndex={enabled ? 0 : -1}
        aria-current={armed}
        className={clsx(
          'flex items-center gap-2 min-w-0 h-7 w-full text-left rounded-lg -mx-1 px-1 cursor-pointer',
          armed ? 'bg-rose-50' : 'hover:bg-slate-50'
        )}
      >
        <span className={clsx(ROUNDEL_COL, 'flex justify-center')}>
          {line
            ? (
                <LineRoundel
                  size="SM"
                  // The station's operator, not the line's: the resolved line
                  // carries `mode` (how it runs), while the roundel's filled-vs-
                  // ringed style keys off who runs it.
                  operator={station.operator}
                  code={line.lineCode}
                  color={line.colorCode as `#${string}`}
                />
              )
            // No lines resolved yet: a neutral dot holds the column so the name
            // does not shift left when the roundel arrives.
            : <span className="w-2 h-2 rounded-full bg-slate-300" aria-hidden />}
        </span>
        <span className={clsx(
          'text-sm truncate',
          emphasis ? 'font-semibold text-slate-800' : 'text-slate-700',
          !station && 'text-slate-400'
        )}
        >
          {station?.name ?? placeholder}
        </span>
      </button>
    </li>
  )
}

/*
 * The desktop rail's head: a fare affordance that becomes the drawn route's
 * summary.
 *
 * One element in two states rather than two elements swapping, because the
 * rider's eye is already on it when the pair completes — growing in place says
 * "your route went here", where a pill disappearing and a card appearing
 * somewhere else says nothing. It also means the pane below it only ever has
 * one thing to dock under.
 *
 * Desktop only. Phones keep the corner button and the floating chip, which suit
 * a viewport where the four corners are the only free space.
 */
export default function MapRailPill({
  endpoints,
  hasPair,
  fare,
  hasError,
  isLoading,
  picking,
  onPick,
  onCancelPick,
  stations,
  onSelectStation,
  onOpenFare,
  onClear
}: MapRailPillProps) {
  const reduced = useReducedMotion()
  /*
   * The card is open while there is anything to show: a complete pair, one end
   * of one, or a field being filled.
   *
   * Half a pair counts. Keying this on `hasPair` alone collapsed the card the
   * instant an origin was chosen — the rider picked a station and watched their
   * answer disappear, with the destination row that would finish the job going
   * with it.
   */
  const open = hasPair || picking !== null || endpoints.from !== null || endpoints.to !== null

  /*
   * The body's natural height, measured rather than transitioned.
   *
   * This is what lets the open/close animate on `transform` alone. The height
   * itself still changes — a search list is taller than two station rows — but
   * it changes when the CONTENT changes, not on every frame of a collapse, so
   * layout runs once instead of a dozen times with ~50 rows mounted.
   *
   * ResizeObserver rather than an effect on `picking`: the height also settles
   * as results come back and as a long station name wraps, and only the element
   * knows when it has stopped moving.
   */
  const bodyRef = useRef<HTMLDivElement>(null)
  const [bodyHeight, setBodyHeight] = useState(0)
  useLayoutEffect(() => {
    const el = bodyRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const measure = () => setBodyHeight(el.getBoundingClientRect().height)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return (
    <div className={clsx('w-full overflow-hidden', picking ? SEARCH_SURFACE_CLASS : SURFACE_CLASS)}>
      {/*
        * The idle row keeps its height in both states and turns into the card's
        * header, so nothing jumps as the rows below it open.
        */}
      {/*
        * The head is a row, not one button, because while picking its icon is a
        * control of its own. Nesting a button inside a button is invalid, so the
        * two are siblings and the title takes the remaining width.
        */}
      <div
        style={{ height: PILL_HEIGHT_PX }}
        className={clsx(
          'flex items-center gap-3 px-4',
          // Rounded on its own only while it IS the whole surface; once the card
          // is open it is the top of a taller box.
          open ? 'rounded-t-2xl' : 'rounded-2xl'
        )}
      >
        {picking
          ? (
              <button
                type="button"
                /*
                 * The way out of search for anyone not reaching for Escape.
                 *
                 * Backs out of the FIELD only — whatever is already picked
                 * stays. Clearing the route is the fare row's X, a different
                 * verb that deserves its own control; one X meaning both would
                 * make an accidental tap while editing a destination throw away
                 * the origin too.
                 */
                onClick={onCancelPick}
                aria-label="Tutup pencarian stasiun"
                className="-ml-1.5 w-8 h-8 shrink-0 rounded-full flex items-center justify-center text-slate-500 hover:bg-slate-100 cursor-pointer transition-transform duration-150 ease-out active:scale-95"
              >
                <XIcon weight="bold" className="w-5 h-5" />
              </button>
            )
          : <MagnifyingGlassIcon weight="bold" className="w-5 h-5 text-slate-400 shrink-0" />}

        <button
          type="button"
          /*
           * Idle, this opens the form on the origin — the first thing a rider
           * has to answer. Once a pair is drawn it opens the fare pane instead,
           * where the criteria, the alternatives and the share live; the rows
           * below are how the pair itself gets edited from here.
           *
           * Inert while picking: the search below is already the answer to
           * "what do you want to change", and re-arming the origin from here
           * would yank a rider mid-way through choosing a destination.
           */
          onClick={() => (hasPair ? onOpenFare() : onPick('from'))}
          disabled={picking !== null}
          aria-label={hasPair ? 'Buka rincian tarif' : 'Cek tarif perjalanan'}
          className={clsx(
            'flex-1 min-w-0 h-full flex items-center text-left',
            picking
              ? 'cursor-default'
              : 'cursor-pointer transition-transform duration-150 ease-out active:scale-[0.99]'
          )}
        >
          <span className="font-bold text-base text-slate-800 truncate">
            {hasPair ? 'Ubah rute' : 'Cek tarif'}
          </span>
        </button>
      </div>

      {/*
        * Two animations, because they do different jobs.
        *
        * The grid track carries the HEIGHT. `1fr`/`0fr` is the only way to reach
        * a content-sized height without hard-coding a pixel number, and the card
        * is content-sized by nature: two station rows or a search list. It is a
        * layout property, so it is the expensive half — kept short, and the only
        * thing on this path.
        *
        * The content carries the MOVEMENT, on transform and opacity alone, which
        * is what the eye actually reads as the card opening. That half is
        * composited.
        *
        * Both run on --ease-ios-spring at 200ms, the same curve and duration as
        * .map-popover-enter and the rest of the map's chrome — a card on its own
        * curve is what made this feel foreign to the app around it.
        */}
      <div
        // The clipping window. `height` is the one layout property here and it
        // is set from a measurement, not transitioned — so opening and closing
        // never put the body's ~50 search rows back through layout.
        className={clsx('overflow-hidden', !reduced && 'transition-[height] duration-200 ease-ios-spring')}
        style={{ height: open ? bodyHeight : 0 }}
      >
        <div
          ref={bodyRef}
          className={clsx(!reduced && 'transition-transform duration-200 ease-ios-spring will-change-transform')}
          style={{
            /*
             * The body slides up behind the window's edge rather than being
             * squashed by it. Composited, so the rows inside are moved as a
             * finished layer instead of re-laid-out every frame — which is what
             * the grid-template-rows version was doing, with a search list
             * mounted, twelve times a collapse.
             */
            transform: open || reduced ? 'translateY(0)' : `translateY(-${bodyHeight}px)`
          }}
        >
          {/* pt-3, not pt-1: the roundels are taller than a text row, and at a
              tighter top padding the first one's ring was shaved by the card's
              own overflow-hidden. */}
          <div className="px-4 pb-3 pt-3 border-t border-slate-100">
            <ol className="flex flex-col py-1">
              <EndpointRow
                station={endpoints.from}
                placeholder="Pilih keberangkatan"
                armed={picking === 'from'}
                enabled={open}
                onClick={() => onPick('from')}
              />
              {/*
                * Centred on the roundel column rather than nudged with padding:
                * the arrow marks the line between the two stops, so it has to
                * sit under the mark it joins whatever width that mark is.
                */}
              <li aria-hidden className="flex items-center h-3">
                <span className={clsx(ROUNDEL_COL, 'flex justify-center')}>
                  <ArrowDownIcon weight="bold" className="w-3 h-3 text-slate-300" />
                </span>
              </li>
              <EndpointRow
                station={endpoints.to}
                placeholder="Pilih tujuan"
                emphasis
                armed={picking === 'to'}
                enabled={open}
                onClick={() => onPick('to')}
              />
            </ol>

            {/*
              * Search replaces the fare line rather than stacking under it: a
              * total for the pair you are halfway through changing is answering
              * a question nobody asked, and the column has to stay short enough
              * not to bury the pane docked below.
              */}
            {picking
              ? (
                  <div className="-mx-4 border-t border-slate-100">
                    <StationSearchList
                      // Remount per field so the query, the focus and the
                      // scroll position all start fresh — a list still scrolled
                      // to the origin's match is the wrong place to begin
                      // picking a destination.
                      key={picking}
                      stations={stations}
                      label={picking === 'from' ? 'Cari stasiun keberangkatan' : 'Cari stasiun tujuan'}
                      current={picking === 'from' ? endpoints.from : endpoints.to}
                      onSelect={station => onSelectStation(picking, station)}
                      onCancel={onCancelPick}
                    />
                  </div>
                )
              : (
                  <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-100">
                    <div className="flex items-center min-w-0">
                      <FareSummary fare={fare} hasError={hasError} isLoading={isLoading} />
                    </div>
                    <button
                      type="button"
                      onClick={onClear}
                      aria-label="Hapus rute dari peta"
                      // Untabbable while collapsed: the rows are still in the
                      // DOM so they can animate, and a hidden control in the tab
                      // order is a focus trap the rider cannot see.
                      tabIndex={hasPair ? 0 : -1}
                      className="rounded-full flex items-center justify-center w-9 h-9 -mr-1.5 text-slate-700 hover:bg-slate-100 cursor-pointer shrink-0"
                    >
                      <XIcon weight="bold" className="w-4 h-4" />
                    </button>
                  </div>
                )}
          </div>
        </div>
      </div>
    </div>
  )
}
