import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import { OPERATORS } from '@commute/constants'
import { haptic } from 'utils/haptics'
import { LIST_STAGGER, LIST_STAGGER_MAX_INDEX, staggerDelay } from 'utils/stagger'
import HighlightMatch from '~/components/highlight-match'
import LineRoundel from '~/components/line-roundel'
import type { PickableStation } from './pickable-station'
import {
  quickPickStations,
  RECENT_PICKS_KEY,
  RECENT_PICKS_MAX,
  rankStations
} from './station-ranking'

// Rows mounted alongside the card's open animation: a comfortable screenful of
// the list, which is 8 rows tall.
const INITIAL_ROWS = 12

interface Props {
  stations: PickableStation[]
  /*
   * The live query, owned by the card above.
   *
   * There is no input here: the endpoint row being filled IS the input, the way
   * Google Maps turns its "Choose starting point" row into the search field.
   * A second box below the rows would ask the same question twice and cost a
   * duplicated row's height.
   */
  query: string
  /*
   * Which endpoint is being filled. Used only to reset the scroll position: a
   * list still scrolled to the origin's match is the wrong place to start
   * picking a destination.
   *
   * A prop rather than a `key` on this component. Remounting would also reset
   * the staged row cap, and replaying that on every field switch made the list
   * jump from twelve rows to full — the jitter this replaced.
   */
  field: 'from' | 'to'
  // Already chosen for this field, if anything — marked in the list so editing
  // an endpoint shows what it currently says.
  current: PickableStation | null
  onSelect: (station: PickableStation) => void
}

/*
 * Station search sized for the desktop rail: an input and a ranked list, inside
 * whatever column it is dropped into.
 *
 * The counterpart to StationPickerDialog, not a replacement for it. That one is
 * a full-screen sheet with a scrim and a 300ms slide-up, which is right on a
 * phone and wrong over a 400px rail on a desktop map — it would cover the very
 * map the rider is picking from.
 *
 * The ranking is shared rather than reimplemented (station-ranking.ts), so the
 * two surfaces cannot disagree about what the best match for a query is.
 *
 * The dialog's staged mounting IS carried over, in a smaller form. Dropping it
 * looked safe — there is no slide-up here to protect — but the cost simply
 * moved: mounting the whole list on the frame the field is armed leaves the
 * card's open animation nothing to run on.
 *
 * Measured on a PRODUCTION build at 10x CPU throttling, worst frame:
 *
 *              cap on    cap off
 *   open        100ms      133ms
 *   close      16.8ms       33ms
 *
 * Measure this on a production build if you revisit it. The dev server's
 * jsxDEV runtime alone doubles script time here (243ms vs 110ms), which is
 * enough to hide what the change is actually worth.
 */
export default function StationSearchList({ stations, query, field, current, onSelect }: Props) {
  /*
   * The input stays instant while the fuzzy scan runs against a deferred value.
   * Load-bearing, not a nicety: the scan walks a few thousand searchables, and
   * feeding it the live query is what made the picker janky before.
   */
  const deferredQuery = useDeferredValue(query)
  const [recentIds, setRecentIds] = useState<readonly string[]>([])
  /*
   * Rows past the first screenful, held back until the card has finished
   * opening. A slow machine cannot mount fifty rows and animate in the same
   * frame, and the rows below the fold are ones nobody is looking at yet.
   */
  const [renderAll, setRenderAll] = useState(false)
  /*
   * Whether this is still the list's entrance.
   *
   * The stagger belongs to the list ARRIVING. Once the rider is typing, the
   * rows are a filter settling and re-staggering them on every keystroke both
   * looks wrong and costs frames — measured at 6x CPU, replaying it per
   * keystroke dropped 12 frames with a 150ms worst frame.
   */
  const entering = query.length === 0
  const listRef = useRef<HTMLUListElement>(null)
  // Back to the top for the new field, without tearing the list down.
  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = 0
  }, [field])

  useEffect(() => {
    try {
      const parsed = JSON.parse(localStorage.getItem(RECENT_PICKS_KEY) ?? '[]') as unknown
      if (parsed instanceof Array) setRecentIds(parsed as string[])
    } catch {
      // Corrupt entry: fall back to popularity-only picks.
    }
    // Just past the card's 200ms open, so the tail commits on a free frame.
    const timer = setTimeout(() => setRenderAll(true), 220)
    return () => clearTimeout(timer)
  }, [])

  const results = useMemo(
    () => rankStations(stations, deferredQuery),
    [stations, deferredQuery]
  )
  const quickPicks = useMemo(
    () => quickPickStations(stations, recentIds),
    [stations, recentIds]
  )

  // Below the query floor the ranked list IS the popular head, so the quick
  // picks would repeat it. Show one or the other, never both.
  const searching = deferredQuery.length >= 2
  const all = searching ? results : quickPicks
  // A typed query re-ranks an already-mounted list, so the cap only applies to
  // the first paint — not to every keystroke after it.
  const shown = renderAll ? all : all.slice(0, INITIAL_ROWS)

  const pick = (station: PickableStation) => {
    haptic()
    setRecentIds((currentIds) => {
      const next = [station.id, ...currentIds.filter(id => id !== station.id)].slice(0, RECENT_PICKS_MAX)
      try {
        localStorage.setItem(RECENT_PICKS_KEY, JSON.stringify(next))
      } catch {
        // Private mode or a full quota: the pick still stands, it just is not
        // remembered for next time.
      }
      return next
    })
    onSelect(station)
  }

  return (
    <div className="flex flex-col min-h-0">
      {!searching && (
        <div className="px-4 pt-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
          {recentIds.length > 0 ? 'Terakhir digunakan' : 'Sering digunakan'}
        </div>
      )}

      {/*
        * Capped and scrollable. The rail is a column with a pane docked under
        * it, so an uncapped list would grow straight over that pane; this keeps
        * the card a predictable height whatever the query matches.
        *
        * 13rem is about five rows — enough that the list reads as a list and
        * the best match is never the only thing visible, while leaving the
        * whole card short enough to sit above the pane rather than across it.
        */}
      {/*
        * The scrollbar appears only once the rider is searching.
        *
        * On a platform with classic overlay-free scrollbars (Windows) the bar
        * takes real layout width, so one appearing as the list crosses the
        * scroll threshold shifts every row sideways. On first open that is pure
        * jitter: the quick picks are a fixed handful nobody needs to scroll.
        * Once results are coming back the list is long and worth scrolling, and
        * the bar is the only thing that says so — so it is shown, and the
        * shift happens once, on a list that has just changed anyway.
        */}
      <ul
        ref={listRef}
        className={clsx(
          'overflow-y-auto overscroll-contain max-h-56 py-1',
          searching ? '[scrollbar-gutter:stable]' : 'no-scrollbar'
        )}
      >
        {shown.map((station, index) => (
          /*
           * Staggered entrance, the same 30ms step and .search-result-enter the
           * phone picker's rows use — rows that arrive together but not all at
           * once. Only the first screenful is staggered; past LIST_STAGGER's cap
           * the delay would outlast the interaction, and rows that far down are
           * scrolled to rather than watched arriving.
           *
           * Keyed on the station alone, and only staggered while `entering`.
           * Keying on the query was tried so a re-rank would replay the
           * entrance: it dropped 12 frames with a 150ms worst frame at 6x CPU,
           * and re-ranking is a filter settling rather than a list arriving.
           */
          <li
            key={station.id}
            className={entering && index <= LIST_STAGGER_MAX_INDEX ? 'search-result-enter' : undefined}
            style={entering && index <= LIST_STAGGER_MAX_INDEX
              ? { animationDelay: staggerDelay(index, LIST_STAGGER) }
              : undefined}
          >
            <button
              type="button"
              onClick={() => pick(station)}
              className={clsx(
                'px-4 py-1.5 flex items-center gap-3 w-full text-left cursor-pointer',
                // `ease` for the hover settle; see the endpoint rows.
                'transition-colors duration-150 ease',
                station.id === current?.id ? 'bg-rose-50' : 'hover:bg-rose-50/60'
              )}
            >
              <span className="flex flex-col flex-1 min-w-0">
                <span className="truncate text-sm font-bold">
                  <HighlightMatch text={station.name} query={searching ? deferredQuery : undefined} />
                </span>
                <span className="text-sm text-slate-500 truncate">
                  {OPERATORS[station.operator]?.name ?? station.operator}
                </span>
              </span>
              {station.sortedLines.length > 0 && (
                <span className="flex flex-row gap-1 shrink-0">
                  {station.sortedLines.slice(0, 3).map(line => (
                    <LineRoundel
                      key={line.lineCode}
                      size="SM"
                      code={line.lineCode}
                      color={line.colorCode}
                      operator={station.operator}
                    />
                  ))}
                </span>
              )}
            </button>
          </li>
        ))}

        {searching && shown.length === 0 && (
          <li className="px-4 py-6 text-center text-sm text-slate-500">
            Stasiun tidak ditemukan
          </li>
        )}
      </ul>
    </div>
  )
}
