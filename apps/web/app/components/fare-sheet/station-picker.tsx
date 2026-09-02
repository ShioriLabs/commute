import type { PickableStation } from './pickable-station'
import { OPERATORS } from '@commute/constants'
import clsx from 'clsx'
import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { Dialog, DialogBackdrop, DialogPanel } from '@headlessui/react'
import { CheckCircleIcon, MagnifyingGlassIcon, XIcon } from '@phosphor-icons/react'
import { haptic } from 'utils/haptics'
import { LIST_STAGGER, LIST_STAGGER_MAX_INDEX, staggerDelay } from 'utils/stagger'
import {
  quickPickStations,
  rankStations,
  readRecentPicks,
  recordRecentPick
} from './station-ranking'
import HighlightMatch from '~/components/highlight-match'
import LineRoundel from '~/components/line-roundel'
import { useIsEmbed } from '~/hooks/use-is-embed'

// Rows mounted right after the slide settles; comfortably past the fold.
// The long tail mounts once the stagger has finished so its React commit
// never steals frames from anything visible.
const INITIAL_ROWS = 20

const StationRow = memo(function StationRow({ station, index, selected, query, onSelect }: {
  station: PickableStation
  index: number
  selected: boolean
  // Deferred query for highlighting; must match the list's filter pass.
  query?: string
  onSelect: (station: PickableStation) => void
}) {
  return (
    <li
      // Stagger only the above-the-fold rows; the rest mount plain and
      // skip offscreen paint entirely via content-visibility.
      className={index <= LIST_STAGGER_MAX_INDEX ? 'search-result-enter' : '[content-visibility:auto] [contain-intrinsic-size:auto_76px]'}
      style={index <= LIST_STAGGER_MAX_INDEX ? { animationDelay: staggerDelay(index, LIST_STAGGER) } : undefined}
    >
      <button
        type="button"
        onClick={() => onSelect(station)}
        className={`px-8 py-3 flex items-center gap-3 w-full text-left cursor-pointer ${selected ? 'bg-rose-50' : 'hover:bg-rose-50/60'}`}
      >
        <span className="flex flex-col gap-1 flex-1 min-w-0">
          <b className="text-lg">
            <HighlightMatch text={station.name} query={query} />
            {'  '}
            <span className="text-sm font-semibold text-gray-600">{ OPERATORS[station.operator]?.name ?? station.operator }</span>
          </b>
          {station.sortedLines?.length
            ? (
                <ul className="flex flex-row gap-1 flex-wrap">
                  {station.sortedLines.map(line => (
                    <li key={line.lineCode}>
                      <LineRoundel size="SM" code={line.lineCode} color={line.colorCode} operator={station.operator} />
                      <span className="sr-only">{line.name}</span>
                    </li>
                  ))}
                </ul>
              )
            : null}
        </span>
        {selected
          ? <CheckCircleIcon weight="fill" className="w-6 h-6 shrink-0 text-[#F55875]" aria-label="Stasiun terpilih" />
          : null}
      </button>
    </li>
  )
})

export default function StationPickerDialog({ open, title, stations, selectedId, onClose, onSelect }: {
  open: boolean
  title: string
  stations: PickableStation[]
  // Station currently chosen for the field being picked, shown with a check.
  selectedId?: string | null
  onClose: () => void
  onSelect: (station: PickableStation) => void
}) {
  const [query, setQuery] = useState('')
  // Input stays instant; the fuzzy scan over the full station list runs
  // against a deferred query so typing doesn't jank (same as the search sheet).
  const deferredQuery = useDeferredValue(query)
  const [recentIds, setRecentIds] = useState<string[]>([])
  // Same trick as BottomSheet: the station list mounts only after the
  // slide-up settles — painting ~150 rows mid-transform drops frames.
  const [ready, setReady] = useState(false)
  const [renderAll, setRenderAll] = useState(false)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const isEmbed = useIsEmbed()

  useEffect(() => {
    if (!open) {
      setReady(false)
      setRenderAll(false)
      return
    }
    // Fresh state per open: last pick's query/filter shouldn't leak into
    // this one (and resetting here, not on select, keeps the list stable
    // while the panel slides out).
    setQuery('')
    // Re-read on every open, not once on mount: this dialog outlives its
    // openings, and the rail's list writes the same store while it is closed.
    setRecentIds(readRecentPicks())
    const readyTimer = setTimeout(() => setReady(true), 300)
    // Focus after the slide settles: popping the keyboard mid-animation
    // resizes the viewport and stutters the transform.
    const focusTimer = setTimeout(() => searchInputRef.current?.focus(), 350)
    // Stagger ends at ~610ms (12 × 30ms delay + 250ms animation).
    const renderAllTimer = setTimeout(() => setRenderAll(true), 650)
    return () => {
      clearTimeout(readyTimer)
      clearTimeout(focusTimer)
      clearTimeout(renderAllTimer)
    }
  }, [open])

  const shownStations = useMemo(
    () => rankStations(stations, deferredQuery),
    [deferredQuery, stations]
  )

  const quickPicks = useMemo(
    () => quickPickStations(stations, recentIds),
    [recentIds, stations]
  )

  // Stable across keystrokes (only changes on pick) so memoized StationRows
  // don't re-render while typing.
  const handleSelect = useCallback((station: PickableStation) => {
    haptic()
    setRecentIds(current => recordRecentPick(station.id, current))
    onSelect(station)
    onClose()
  }, [onSelect, onClose])

  return (
    <Dialog open={open} onClose={onClose} className="relative z-modal">
      {/* Dark scrim (not white like elsewhere) so the sheet edge and slide-up
          read against the fare page peeking behind it. */}
      <DialogBackdrop transition className="fixed inset-0 bg-slate-950/25 duration-300 ease-out data-closed:opacity-0" />
      <div className="fixed inset-0 flex w-screen items-end">
        <DialogPanel
          transition
          // ease-ios-spring (app.css), shared with the criteria sheets and the
          // map/home entrance animations: it front-loads the travel and settles,
          // which reads as weight rather than a polite decelerate. The scrim
          // above stays ease-out — see criteria/criterion-sheet.tsx.
          //
          // dvh vs vh: see fare.tsx / use-is-embed.ts.
          className={clsx(
            'bg-white w-screen overflow-y-auto [scrollbar-gutter:stable] rounded-t-2xl will-change-transform transition duration-300 ease-ios-spring data-closed:translate-y-full',
            isEmbed ? 'h-[calc(100vh-0.75rem)]' : 'h-[calc(100dvh-0.75rem)]'
          )}
        >
          <div className="p-8 pb-4 sticky top-0 z-[1] max-w-3xl mx-auto bg-white rounded-t-2xl">
            <div className="flex gap-4 items-center justify-between">
              <h1 className="font-bold text-2xl">{ title }</h1>
              <button
                onClick={onClose}
                aria-label="Tutup pemilihan stasiun"
                className="rounded-full leading-0 flex items-center justify-center w-8 h-8 cursor-pointer"
              >
                <XIcon weight="bold" className="w-6 h-6" />
              </button>
            </div>
            <div className="relative mt-4">
              <MagnifyingGlassIcon weight="bold" className="w-5 h-5 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              <input
                ref={searchInputRef}
                className="w-full pl-11 pr-4 py-2.5 rounded-xl bg-stone-100/80 border-2 border-stone-200/40 focus:outline-2 focus:outline-[#F55875]/60"
                type="text"
                placeholder="Cari nama atau kode stasiun"
                value={query}
                onChange={e => setQuery(e.target.value)}
                aria-label="Cari stasiun berdasarkan nama atau kode"
              />
            </div>
          </div>
          {ready && query.length < 2 && quickPicks.length > 0
            ? (
                <div className="max-w-3xl mx-auto">
                  <span className="block px-8 pt-1 text-xs font-bold uppercase tracking-wide text-slate-400">Sering dipilih</span>
                  <div className="px-8 pt-2 pb-1 flex gap-2 overflow-x-auto no-scrollbar">
                    {quickPicks.map(station => (
                      <button
                        key={station.id}
                        type="button"
                        onClick={() => handleSelect(station)}
                        className="shrink-0 rounded-full bg-rose-100 text-pink-800 pl-2 pr-3.5 py-1.5 flex items-center gap-2 text-sm font-semibold cursor-pointer"
                      >
                        {station.sortedLines?.length
                          ? (
                              <span className="flex -space-x-1.5">
                                {station.sortedLines.map(line => (
                                  <LineRoundel key={line.lineCode} size="SM" code={line.lineCode} color={line.colorCode} operator={station.operator} />
                                ))}
                              </span>
                            )
                          : null}
                        { station.name }
                      </button>
                    ))}
                  </div>
                </div>
              )
            : null}
          <ul className="mt-2 max-w-3xl mx-auto pb-8">
            {(ready ? (renderAll ? shownStations : shownStations.slice(0, INITIAL_ROWS)) : []).map((station, index) => (
              <StationRow
                key={station.id}
                station={station}
                index={index}
                selected={station.id === selectedId}
                // Deferred on purpose: the live query would force every row to
                // re-render at urgent priority on each keystroke.
                query={deferredQuery.length >= 2 ? deferredQuery : undefined}
                onSelect={handleSelect}
              />
            ))}
            {ready && shownStations.length === 0
              ? <li className="px-8 py-10 text-center text-slate-400">Stasiun tidak ditemukan</li>
              : null}
          </ul>
        </DialogPanel>
      </div>
    </Dialog>
  )
}
