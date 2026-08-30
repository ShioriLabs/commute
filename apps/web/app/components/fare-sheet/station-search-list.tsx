import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { MagnifyingGlassIcon } from '@phosphor-icons/react'
import clsx from 'clsx'
import { OPERATORS } from '@commute/constants'
import { haptic } from 'utils/haptics'
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
  // The field being filled, for the input's label and placeholder.
  label: string
  // Already chosen for this field, if anything — shown pre-filled so editing an
  // endpoint starts from what it currently says.
  current: PickableStation | null
  onSelect: (station: PickableStation) => void
  onCancel: () => void
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
export default function StationSearchList({ stations, label, current, onSelect, onCancel }: Props) {
  const [query, setQuery] = useState('')
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
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    try {
      const parsed = JSON.parse(localStorage.getItem(RECENT_PICKS_KEY) ?? '[]') as unknown
      if (parsed instanceof Array) setRecentIds(parsed as string[])
    } catch {
      // Corrupt entry: fall back to popularity-only picks.
    }
    // Focus immediately. The dialog waits 350ms because focusing mid-slide pops
    // the phone keyboard and stutters the transform; nothing here is moving.
    inputRef.current?.focus()
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
      <div className="relative px-3 pt-2 pb-1">
        <MagnifyingGlassIcon
          weight="bold"
          className="w-4 h-4 absolute left-6 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
        />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          // Escape backs out of the field rather than clearing it: the rider is
          // one key from where they were, and an emptied field they did not ask
          // for reads as the app losing their work.
          onKeyDown={e => e.key === 'Escape' && onCancel()}
          aria-label={label}
          placeholder={current ? current.name : 'Ketik atau tap stasiun di peta'}
          className="w-full rounded-xl bg-slate-100 pl-9 pr-3 py-2 text-sm placeholder:text-slate-400 outline-none focus:ring-2 focus:ring-[#F55875]/40"
        />
      </div>

      {!searching && (
        <div className="px-4 pt-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
          {recentIds.length > 0 ? 'Terakhir dipakai' : 'Sering dipakai'}
        </div>
      )}

      {/*
        * Capped and scrollable. The rail is a column with a pane docked under
        * it, so an uncapped list would grow straight over that pane; this keeps
        * the card a predictable height whatever the query matches.
        */}
      <ul className="overflow-y-auto overscroll-contain max-h-64 py-1">
        {shown.map(station => (
          <li key={station.id}>
            <button
              type="button"
              onClick={() => pick(station)}
              className={clsx(
                'px-4 py-2 flex items-center gap-3 w-full text-left cursor-pointer',
                station.id === current?.id ? 'bg-rose-50' : 'hover:bg-rose-50/60'
              )}
            >
              <span className="flex flex-col flex-1 min-w-0">
                <span className="text-sm truncate">
                  <HighlightMatch text={station.name} query={searching ? deferredQuery : undefined} />
                </span>
                <span className="text-[11px] text-slate-500 truncate">
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
