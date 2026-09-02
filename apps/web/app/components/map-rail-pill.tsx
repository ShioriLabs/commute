import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ArrowDownIcon, CaretDownIcon, MagnifyingGlassIcon, XIcon } from '@phosphor-icons/react'
import clsx from 'clsx'
import type { FareJourney, FareResult, Line } from '@commute/schemas'
import { useReducedMotion } from '~/hooks/reduced-motion'
import LineRoundel from './line-roundel'
import StationSearchList from './fare-sheet/station-search-list'
import type { PickableStation } from './fare-sheet/pickable-station'
import FareSummary from './fare-summary'
import { Link } from 'react-router'
import { ArrowSquareOutIcon } from '@phosphor-icons/react'
import { buildFarePath } from 'utils/fare-url'
import FareShareButton from './fare-sheet/fare-share-button'
import CriteriaBar from './fare-sheet/criteria/criteria-bar'
import RouterToggle from './fare-sheet/router-toggle'
import type { FareCriteria } from 'utils/fare-criteria'
import type { FareRouter } from 'utils/fare-router'
import { operatorOfLineKey, useLines } from '~/hooks/use-lines'
import { boardingLineKeys, endpointRoundelLines } from './fare-sheet/journeys'

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
  /*
   * The journey the card is about, for signing each end with the line actually
   * ridden there rather than whichever line the stop happens to list first.
   *
   * The journey rather than two resolved lines, because the card is the thing
   * that knows a half-filled pair has no journey at all — see boardingLineKeys.
   */
  journey: FareJourney | null
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
  onClear: () => void
  /*
   * Reopens the trip card docked below, and whether it is currently collapsed.
   *
   * The control lives here rather than in the trip card because a collapsed
   * card has nowhere to put it: this row is the only thing still on screen.
   * Undefined on a build with no trip card, which renders nothing.
   */
  tripCollapsed?: boolean
  onExpandTrip?: () => void
  /*
   * The query's own settings, shown here rather than behind the fare pane.
   *
   * They belong beside the route they price: changing a payment method used to
   * mean opening a pane over the map, changing it, and closing the pane to see
   * the corridor redraw. Both stay visible before a pair resolves, because they
   * are standing settings and not a property of an answer.
   */
  criteria: FareCriteria
  onCriteriaChange: (criteria: FareCriteria) => void
  router: FareRouter
  onRouterChange: (router: FareRouter) => void
  /*
   * The fetched pair's ids, for sharing and for the /fare link.
   *
   * The ids rather than the resolved stations: the search index omits TJ
   * topology-only halte, so a pair that prices perfectly well can leave
   * `endpoints` null. Same reasoning map-fare-sheet.tsx used when it built the
   * fare path from the query rather than from what the rows display.
   */
  pairFromId: string | null | undefined
  pairToId: string | null | undefined
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

/*
 * The mark column both stops and the arrow between them share. Fixed rather
 * than intrinsic so the two names start on the same x whether a row shows a
 * roundel or the placeholder dot, and so the arrow can centre on it.
 *
 * One SM roundel wide, and it stays that width when a stop stacks several: the
 * extra roundels are laid out RIGHT-TO-LEFT out of the column's left edge, into
 * the 12px the card's padding leaves free. The anchor — the first line in
 * display order — holds the column, so the names, the arrow and the rows'
 * alignment do not move when a stack of three collapses to the one line a
 * resolved route rides.
 */
const ROUNDEL_COL = 'w-6 shrink-0'

/*
 * Taken out of the normal flow rather than laid out in it. In flow the group is
 * wider than the column, and `justify-center` then splits the overflow evenly:
 * measured, that pushed the anchor 18px right into the station name and hung
 * the last roundel 2px past the card's left edge. Absolute, with its right edge
 * pinned to the column, the stack can only grow the one direction there is room
 * for — leftward, into the padding.
 */
const ROUNDEL_STACK_CLASS = 'absolute right-0 top-1/2 -translate-y-1/2 flex flex-row-reverse'

/*
 * How far a stacked roundel sits under the one before it: 16px of a 24px mark,
 * applied per roundel rather than via `space-x`, which reverses awkwardly.
 *
 * Deep enough to cover the codes behind the anchor, which is the point rather
 * than a cost. The row already answers "which line" with the anchor on top; the
 * ones behind it are saying "and this stop has others", and a deck of cards is
 * how that reads at a glance. Trying to keep every code legible instead spread
 * the stack past the card's left edge and only ever fitted two.
 *
 * About 8px of each is left showing, less as they scale down behind the anchor
 * — enough to read as a distinct disc in its line's colour, which is the whole
 * signal a covered roundel still carries.
 */
const ROUNDEL_STACK_OVERLAP_PX = 16

/*
 * Each roundel further back is drawn smaller, compounding per depth.
 *
 * Overlap alone says one disc is in front of another, but says nothing about
 * which — two flat circles at the same size read as a row that happens to
 * collide. Shrinking the ones behind gives the stack a front, so the anchor is
 * the mark and the rest are visibly a pile under it.
 *
 * `scale` rather than a smaller roundel size: it leaves the layout box alone,
 * so the 8px step above stays the thing that positions them, and SM is already
 * the smallest size the component draws.
 */
const ROUNDEL_STACK_SCALE = 0.85

/*
 * One endpoint row's height, shared by both of its forms.
 *
 * A single constant because the row swaps between a button and an input when it
 * is armed, and the two drifted: an h-8 input against an h-7 button moved the
 * whole card 4px the moment a field took focus. Nothing below a focus ring
 * should change size.
 */
const ROW_H = 'h-8'

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
 * What an interchange shows depends on whether a route exists. Routed, the row
 * signs the one line the journey rides — which is a property of the JOURNEY,
 * not of the stop: Manggarai serves Lin Soekarno-Hatta, Lin Bogor and Lin
 * Cikarang, and signing it from the station's own display order put an airport
 * roundel over a Cikarang ride. Unrouted there is no such line to name, so the
 * row stacks the stop's own instead, because promoting whichever sorts first
 * reads as a claim about a route nobody has chosen yet. See
 * endpointRoundelLines.
 */
/*
 * The row's mark: the stacked roundels, or a dot holding the column until there
 * is something to draw.
 *
 * Shared by the row's two forms — armed it is an input, at rest a button — which
 * used to render this block twice. They had already drifted once (only one of
 * them carried the comment explaining the operator), and the mark is the part
 * that must not differ between them: a roundel that changed as a field took
 * focus would read as the answer changing.
 */
function EndpointMark({ marks }: { marks: { line: Line, operator: string }[] }) {
  return (
    <span className={clsx(ROUNDEL_COL, 'relative flex justify-center')}>
      {marks.length > 0
        ? (
            /*
             * `flex-row-reverse` so the stack is painted right-to-left: the
             * anchor ends up rightmost, with each earlier roundel tucked under
             * the one to its right. Rendered in reverse too, so display order
             * still reads left-to-right on screen. Which one is on TOP is set
             * explicitly below — source order would stack them upside down.
             */
            <span className={ROUNDEL_STACK_CLASS}>
              {[...marks].reverse().map((mark, index) => (
                /*
                 * The offset rides a wrapper rather than the roundel:
                 * LineRoundel already spends its own `style` on the line
                 * colour, and widening a component the whole app shares for one
                 * caller's margin is the wrong trade.
                 *
                 * The anchor (index 0 here, painted last) keeps the column;
                 * every roundel behind it is pulled left under its neighbour.
                 * `marginRight`, not left: the row is `flex-row-reverse`, so a
                 * child's right margin is the gap on its LEFT on screen.
                 */
                <span
                  key={`${mark.operator}:${mark.line.lineCode}`}
                  className="leading-0"
                  style={{
                    ...(index > 0 ? { marginRight: -ROUNDEL_STACK_OVERLAP_PX } : {}),
                    /*
                     * Painted front-to-back by hand. Source order alone gets
                     * this backwards: the anchor is rendered FIRST so that
                     * `flex-row-reverse` puts it rightmost, which also makes it
                     * the first thing painted and therefore the bottom of the
                     * pile — the smallest disc ended up on top of the mark it
                     * is supposed to sit behind.
                     */
                    zIndex: marks.length - index,
                    /*
                     * Scaled about its RIGHT edge, which is the sliver left
                     * showing. Scaling about the centre would pull each disc
                     * away from the anchor as it shrank, opening a gap exactly
                     * where the stack is supposed to look continuous.
                     */
                    ...(index > 0
                      ? {
                          transform: `scale(${ROUNDEL_STACK_SCALE ** index})`,
                          transformOrigin: 'right center'
                        }
                      : {})
                  }}
                >
                  <LineRoundel
                    size="SM"
                    // The operator, not the line's `mode`: the resolved line
                    // carries how it runs, while the roundel's filled-vs-ringed
                    // style keys off who runs it.
                    operator={mark.operator}
                    code={mark.line.lineCode}
                    color={mark.line.colorCode as `#${string}`}
                  />
                </span>
              ))}
            </span>
          )
        // No lines resolved yet: a neutral dot holds the column so the name
        // does not shift left when the roundel arrives.
        : <span className="w-2 h-2 rounded-full bg-slate-300" aria-hidden />}
    </span>
  )
}

function EndpointRow({
  station,
  line: ridden,
  placeholder,
  emphasis = false,
  armed,
  enabled,
  onClick,
  query,
  onQueryChange,
  onCancel,
  label
}: {
  station: PickableStation | null
  /*
   * The line this end is boarded on or alighted from, and the operator running
   * it, when a journey has said. Null before one has, which stacks the stop's
   * own lines instead.
   *
   * The operator travels with the line because a journey can leave the stop's
   * own operator behind — a KCI entry whose ride is a TJ corridor would
   * otherwise draw a filled corridor roundel in the ringed rail style.
   */
  line: { line: Line, operator: string } | null
  placeholder: string
  emphasis?: boolean
  // This field is the one being filled: it becomes the text input, and the map
  // is armed to answer a tap with it.
  armed: boolean
  // The card is open. Rows stay mounted while it is closed so the collapse can
  // animate, and a control inside a zero-height box must not be reachable.
  enabled: boolean
  onClick: () => void
  query: string
  onQueryChange: (value: string) => void
  onCancel: () => void
  label: string
}) {
  const marks = endpointRoundelLines(station, ridden)
  const inputRef = useRef<HTMLInputElement>(null)
  // Focus on arming, not on mount: the row is mounted the whole time, and it is
  // becoming the input that should take the caret.
  useEffect(() => {
    if (armed) inputRef.current?.focus()
  }, [armed])

  /*
   * Armed, the row IS the search field.
   *
   * A separate input below the rows would ask the same question twice — the row
   * already names the endpoint being changed — and cost a duplicated row's
   * height in a column that has a pane docked under it.
   */
  if (armed) {
    return (
      <li className={clsx('flex items-center gap-2 min-w-0', ROW_H)}>
        <EndpointMark marks={marks} />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={e => onQueryChange(e.target.value)}
          // Escape backs out of the field rather than clearing it: the rider is
          // one key from where they were, and an emptied field they did not ask
          // for reads as the app losing their work.
          onKeyDown={e => e.key === 'Escape' && onCancel()}
          aria-label={label}
          /*
           * Armed and empty, the hint is that the map is live — the row's own
           * name already said which end this is, and "tap a station" is the
           * part a rider would not otherwise guess.
           */
          placeholder={station ? station.name : 'Ketik atau tap stasiun di peta'}
          className="flex-1 min-w-0 bg-transparent text-sm outline-none placeholder:text-slate-400"
        />
      </li>
    )
  }

  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        tabIndex={enabled ? 0 : -1}
        className={clsx(
          'flex items-center gap-2 min-w-0 w-full text-left rounded-lg -mx-1 px-1 cursor-pointer',
          ROW_H,
          // `ease`, not the ease-out the entrances use: a hover is a state
          // settling, not something arriving.
          'transition-colors duration-150 ease hover:bg-slate-50'
        )}
      >
        <EndpointMark marks={marks} />
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
  journey,
  hasError,
  isLoading,
  picking,
  onPick,
  onCancelPick,
  stations,
  onSelectStation,
  onClear,
  tripCollapsed,
  onExpandTrip,
  criteria,
  onCriteriaChange,
  router,
  onRouterChange,
  pairFromId,
  pairToId
}: MapRailPillProps) {
  const reduced = useReducedMotion()
  /*
   * Each end's roundel, resolved from the journey rather than from the stop.
   *
   * The dictionary lookup happens here, once, rather than in each row: both
   * rows read the same `/operators` cache, and the rows are the wrong place to
   * learn that a line key is not a line.
   */
  const { line: lookupLine } = useLines()
  const boarding = boardingLineKeys(journey)
  /*
   * A key resolves to a roundel only when the dictionary knows it. Mid-deploy,
   * or against a service-worker cache holding a line the answer predates, the
   * lookup misses — and a key with no colour is not something to draw, so the
   * row falls back to the stop's own line rather than a blank circle.
   */
  const riddenOf = useCallback((key: string | null) => {
    const line = lookupLine(key ?? undefined)
    const operator = operatorOfLineKey(key)
    return line && operator ? { line, operator } : null
  }, [lookupLine])
  const riddenFrom = riddenOf(boarding.from)
  const riddenTo = riddenOf(boarding.to)
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
  /*
   * The search query, owned here because two children need it: the armed row
   * renders it (the row IS the input) and the list below ranks against it.
   */
  const [query, setQuery] = useState('')
  // Fresh per field. Carrying a query from the origin into the destination
  // would open the second field already filtered by the first one's answer.
  useEffect(() => setQuery(''), [picking])

  const farePath = buildFarePath(pairFromId, pairToId, criteria)

  /*
   * Replay the body's fade when it swaps between the search list and the fare
   * row.
   *
   * By hand rather than with a `key`: both arms render into the same slot, so
   * React reconciles them as one element and a CSS animation on it never
   * restarts. Rewinding the running animation is what does it. Empty under
   * reduced motion, where app.css sets `animation: none`.
   */
  const bodyFadeRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    for (const animation of bodyFadeRef.current?.getAnimations() ?? []) {
      animation.currentTime = 0
      animation.play()
    }
  }, [picking])

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
        {/*
          * One fixed slot for both icons, so the title beside it never moves.
          *
          * The two used to swap as siblings of different widths — a w-5 glyph
          * for a w-8 button — which shifted the label sideways the instant a
          * field was armed. They now stack in the same box and cross-fade: the
          * magnifier is decoration and the X is a control, but the rider should
          * only ever see one thing become the other in place.
          */}
        <span className="relative w-8 h-8 -ml-1.5 shrink-0">
          <button
            type="button"
            /*
             * The way out of search for anyone not reaching for Escape.
             *
             * Backs out of the FIELD only — whatever is already picked stays.
             * Clearing the route is the fare row's X, a different verb that
             * deserves its own control; one X meaning both would make an
             * accidental tap while editing a destination throw away the origin
             * too.
             */
            onClick={onCancelPick}
            aria-label="Tutup pencarian stasiun"
            // Untabbable and inert when there is no search to close, so the
            // slot is a plain icon the rest of the time.
            tabIndex={picking ? 0 : -1}
            aria-hidden={!picking}
            className={clsx(
              'absolute inset-0 rounded-full flex items-center justify-center text-slate-500',
              'transition-[opacity,transform,background-color] duration-150 ease-out',
              picking
                ? 'opacity-100 hover:bg-slate-100 cursor-pointer active:scale-[0.97]'
                : 'opacity-0 pointer-events-none scale-90'
            )}
          >
            <XIcon weight="bold" className="w-5 h-5" />
          </button>
          <MagnifyingGlassIcon
            weight="bold"
            aria-hidden
            className={clsx(
              'absolute inset-0 m-auto w-5 h-5 text-slate-400 pointer-events-none',
              'transition-[opacity,transform] duration-150 ease-out',
              picking ? 'opacity-0 scale-90' : 'opacity-100'
            )}
          />
        </span>

        <button
          type="button"
          /*
           * Arms the origin, drawn pair or not.
           *
           * It used to open the fare pane once a pair existed, under the label
           * "Ubah rute" — which was never true: the rows directly below are how
           * a route gets changed. Now that the criteria, the router, the
           * options, the share and the /fare link all live in this column, the
           * pane has nothing of its own left to show on desktop, so there is
           * nothing for this to open. Starting a new search is what a rider
           * reaching for the card's title actually wants, and it is what the
           * magnifier beside it has always promised.
           *
           * Inert while picking: the search below is already the answer to
           * "what do you want to change", and re-arming the origin from here
           * would yank a rider mid-way through choosing a destination.
           */
          onClick={() => onPick('from')}
          disabled={picking !== null}
          aria-label="Cari rute lain"
          className={clsx(
            'flex-1 min-w-0 h-full flex items-center text-left',
            picking
              ? 'cursor-default'
              : 'cursor-pointer transition-transform duration-150 ease-out active:scale-[0.99]'
          )}
        >
          <span className="font-bold text-base text-slate-800 truncate">
            {hasPair ? 'Cari rute lain' : 'Cek rute dan tarif'}
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
                line={riddenFrom}
                placeholder="Dari mana?"
                armed={picking === 'from'}
                enabled={open}
                onClick={() => onPick('from')}
                query={query}
                onQueryChange={setQuery}
                onCancel={onCancelPick}
                label="Cari stasiun keberangkatan"
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
                line={riddenTo}
                placeholder="Mau ke mana?"
                emphasis
                armed={picking === 'to'}
                enabled={open}
                onClick={() => onPick('to')}
                query={query}
                onQueryChange={setQuery}
                onCancel={onCancelPick}
                label="Cari stasiun tujuan"
              />
            </ol>

            {/*
              * Search replaces the fare line rather than stacking under it: a
              * total for the pair you are halfway through changing is answering
              * a question nobody asked, and the column has to stay short enough
              * not to bury the pane docked below.
              */}
            {/*
              * Faded on every swap. Same reasoning as the trip card below: this
              * body sits inside an animating height, and without the fade the
              * box glided while a whole search list appeared instantly inside
              * it. Restarted by hand for the same reason — see bodyFadeRef.
              */}
            <div ref={bodyFadeRef} className="content-fade">
              {picking
                ? (
                    <div className="-mx-4 border-t border-slate-100">
                      <StationSearchList
                        /*
                         * NOT keyed on `picking`. Remounting per field reset the
                         * staged mount, so switching fields replayed the 12-row
                         * cap and the list visibly snapped to full height. The
                         * list resets its own scroll on the field instead.
                         */
                        field={picking}
                        stations={stations}
                        query={query}
                        current={picking === 'from' ? endpoints.from : endpoints.to}
                        onSelect={station => onSelectStation(picking, station)}
                      />
                    </div>
                  )
                : (
                    <>
                      {/*
                      * The query's settings, above the answer they produce.
                      *
                      * `wrap` is not optional here: unwrapped, CriteriaBar bleeds
                      * -mx-8 px-8 for a scrolling rail and assumes 8-unit parent
                      * padding, which this px-4 card does not give it. Wrapped it
                      * is two chips on one line, which fits the column.
                      */}
                      <CriteriaBar criteria={criteria} onChange={onCriteriaChange} wrap />
                      <RouterToggle router={router} onChange={onRouterChange} />

                      {/*
                        * The answer, and the two things a rider does with it.
                        *
                        * Last in the card rather than first: the rows above ask
                        * where you are going and how you are paying, and this is
                        * what they add up to — so it sits at the foot of the card,
                        * directly above the trip card that breaks it down. That
                        * also puts the clear and the expand at the column's waist,
                        * where the two cards meet, instead of stranding them
                        * mid-way up with settings below them.
                        */}
                      <div className="mt-3 flex items-center justify-between gap-2 pt-2 border-t border-slate-100">
                        <div className="flex items-center min-w-0">
                          <FareSummary fare={fare} hasError={hasError} isLoading={isLoading} />
                        </div>
                        <div className="flex items-center shrink-0 -mr-1.5">
                          {/*
                            * Renders nothing without a pair, so it costs no width
                            * on the empty card — see FareShareButton.
                            */}
                          <span className="flex items-center justify-center w-9 h-9 text-slate-700 [&>button]:w-9 [&>button]:h-9 [&_svg]:w-4 [&_svg]:h-4">
                            <FareShareButton fromId={pairFromId} toId={pairToId} criteria={criteria} />
                          </span>
                          {/*
                            * Brings the trip card back, and is here only while it
                            * is away — expanded, that card's own chevron is the
                            * control, and two carets pointing at each other is a
                            * toggle the rider has to decode rather than an
                            * affordance.
                            */}
                          {tripCollapsed && onExpandTrip
                            ? (
                                <button
                                  type="button"
                                  onClick={onExpandTrip}
                                  aria-label="Tampilkan panel rute"
                                  aria-expanded={false}
                                  tabIndex={hasPair ? 0 : -1}
                                  className="rounded-full flex items-center justify-center w-9 h-9 text-slate-700 cursor-pointer shrink-0 transition-[background-color,transform] duration-150 ease hover:bg-slate-100 active:scale-[0.97]"
                                >
                                  <CaretDownIcon weight="bold" className="w-4 h-4" />
                                </button>
                              )
                            : null}
                          <button
                            type="button"
                            onClick={onClear}
                            aria-label="Hapus rute dari peta"
                            // Untabbable while collapsed: the rows are still in the
                            // DOM so they can animate, and a hidden control in the
                            // tab order is a focus trap the rider cannot see.
                            tabIndex={hasPair ? 0 : -1}
                            className="rounded-full flex items-center justify-center w-9 h-9 text-slate-700 cursor-pointer shrink-0 transition-[background-color,transform] duration-150 ease hover:bg-slate-100 active:scale-[0.97]"
                          >
                            <XIcon weight="bold" className="w-4 h-4" />
                          </button>
                        </div>
                      </div>

                      {/*
                        * Out to the fare page proper.
                        *
                        * /fare owns the canonical URL — it is the one that is
                        * SEO-decorated, OG-imaged and sitemapped — so this card
                        * has to offer a way there rather than being a dead end.
                        * It was the last thing the desktop pane still carried
                        * alone; with it here the pane has nothing of its own.
                        */}
                      {farePath
                        ? (
                            <Link
                              to={farePath}
                              className="mt-2 flex items-center justify-center gap-1.5 text-xs font-semibold text-slate-500 cursor-pointer transition-colors duration-150 ease hover:text-slate-700"
                            >
                              Buka halaman tarif
                              <ArrowSquareOutIcon weight="bold" className="w-3.5 h-3.5" />
                            </Link>
                          )
                        : null}
                    </>
                  )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
