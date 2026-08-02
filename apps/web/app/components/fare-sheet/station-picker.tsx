import type { OperatorCode } from '@commute/schemas'
import type { PickableStation } from './pickable-station'
import { OPERATORS } from '@commute/constants'
import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { Dialog, DialogBackdrop, DialogPanel } from '@headlessui/react'
import { CheckCircleIcon, MagnifyingGlassIcon, XIcon } from '@phosphor-icons/react'
import { haptic } from 'utils/haptics'
import { filterBestTier, keywordScore, SCORE_THRESHOLD } from 'utils/fuzzy-match'
import { LIST_STAGGER, LIST_STAGGER_MAX_INDEX, staggerDelay } from 'utils/stagger'
import HighlightMatch from '~/components/highlight-match'
import LineRoundel from '~/components/line-roundel'
import { sortLineKeysForDisplay } from '~/utils/lines'
import { sortLinesForDisplay } from './pickable-station'

/*
 * Best match across everything the station is known by.
 *
 * This used to lowercase `name`/`officialName`/`code` into a client-side index
 * and score each field in turn — "sudirman baru" has to keep finding BNI City,
 * and only the operator's own spelling carries that. The prebuilt index now
 * ships all of them pre-lowercased in `keywords`, including both halves of a
 * folded directional pair, so the per-field pass collapses into one scan and
 * the index it needed disappears.
 *
 * Lowest wins: keywordScore returns 0 for an exact match and grows with edit
 * distance, so the closest keyword is the station's score.
 */
function getStationScore(station: PickableStation, query: string) {
  let best = Number.POSITIVE_INFINITY
  for (const keyword of station.keywords) {
    const score = keywordScore(keyword, query)
    if (score === 0) return 0
    if (score < best) best = score
  }
  return best
}

// Recently picked fare stations feed the quick-pick chips (same pattern as
// the search sheet's 'recently-searched').
const RECENT_PICKS_KEY = 'fare-recent-stations'
const RECENT_PICKS_MAX = 4

// Rows mounted right after the slide settles; comfortably past the fold.
// The long tail mounts once the stagger has finished so its React commit
// never steals frames from anything visible.
const INITIAL_ROWS = 20

// Memoized: rendered from the deferred filter pass, so the urgent keystroke
// render must bail out here — otherwise the whole list re-renders per
// keystroke at urgent priority and blocks the input.
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
          {station.lines?.length
            ? (
                <ul className="flex flex-row gap-1 flex-wrap">
                  {sortLinesForDisplay(station.lines, station.operator, sortLineKeysForDisplay).map(line => (
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
  const [operatorFilter, setOperatorFilter] = useState<string | null>(null)
  const [recentIds, setRecentIds] = useState<string[]>([])
  // Same trick as BottomSheet: the station list mounts only after the
  // slide-up settles — painting ~150 rows mid-transform drops frames.
  const [ready, setReady] = useState(false)
  const [renderAll, setRenderAll] = useState(false)
  const searchInputRef = useRef<HTMLInputElement>(null)

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
    setOperatorFilter(null)
    try {
      const parsed = JSON.parse(localStorage.getItem(RECENT_PICKS_KEY) ?? '[]') as unknown
      if (parsed instanceof Array) setRecentIds(parsed as string[])
    } catch {
      // Corrupt entry: fall back to popularity-only chips.
    }
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

  // Operators present in the pickable set, in canonical OPERATORS order.
  const operators = useMemo(() => {
    const present = new Map(stations.map(station => [station.operator, OPERATORS[station.operator]?.name ?? station.operator]))
    // NUL is an internal placeholder and never appears on a station, so the
    // cast matches the narrowed OperatorCode the schemas expose.
    return (Object.keys(OPERATORS) as OperatorCode[])
      .filter(code => present.has(code))
      .map(code => ({ code, name: present.get(code)! }))
  }, [stations])

  const filteredStations = useMemo(
    () => (operatorFilter ? stations.filter(station => station.operator === operatorFilter) : stations),
    [operatorFilter, stations]
  )

  const shownStations = useMemo(() => {
    if (deferredQuery.length < 2) {
      // No query: full list, most popular first, so common picks are one tap away.
      return [...filteredStations].sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || a.name.localeCompare(b.name))
    }
    const query = deferredQuery.toLowerCase()
    const scored = filteredStations
      .map((station) => {
        const matchScore = getStationScore(station, query)
        return { station, matchScore, finalScore: matchScore + (1 - (station.score ?? 0) / 100) }
      })
      .filter(({ finalScore }) => finalScore < SCORE_THRESHOLD)
    // Corrections are a fallback: exact matches hide typo matches, word-typo
    // matches hide window matches.
    return filterBestTier(scored, ({ matchScore }) => matchScore)
      .sort((a, b) => a.finalScore - b.finalScore || a.station.name.localeCompare(b.station.name))
      .map(({ station }) => station)
  }, [deferredQuery, filteredStations])

  // Recent picks first, padded with the most popular stations for first-time
  // users (and when recents fall outside the pickable set).
  const quickPicks = useMemo(() => {
    const byId = new Map(filteredStations.map(station => [station.id, station]))
    const picks: PickableStation[] = []
    for (const id of recentIds) {
      const station = byId.get(id)
      if (station && !picks.some(pick => pick.id === station.id)) picks.push(station)
      if (picks.length === RECENT_PICKS_MAX) return picks
    }
    const popular = [...filteredStations].sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    for (const station of popular) {
      if (picks.some(pick => pick.id === station.id)) continue
      picks.push(station)
      if (picks.length === RECENT_PICKS_MAX) break
    }
    return picks
  }, [recentIds, filteredStations])

  // Stable across keystrokes (only changes on pick) so memoized StationRows
  // don't re-render while typing.
  const handleSelect = useCallback((station: PickableStation) => {
    haptic()
    setRecentIds((current) => {
      const newRecents = [station.id, ...current.filter(id => id !== station.id)].slice(0, RECENT_PICKS_MAX)
      localStorage.setItem(RECENT_PICKS_KEY, JSON.stringify(newRecents))
      return newRecents
    })
    onSelect(station)
    onClose()
  }, [onSelect, onClose])

  return (
    <Dialog open={open} onClose={onClose} className="relative z-50">
      {/* Dark scrim (not white like elsewhere) so the sheet edge and slide-up
          read against the fare page peeking behind it. */}
      <DialogBackdrop transition className="fixed inset-0 bg-slate-950/25 duration-300 ease-out data-closed:opacity-0" />
      <div className="fixed inset-0 flex w-screen items-end">
        <DialogPanel
          transition
          className="bg-white w-screen h-[calc(100dvh-0.75rem)] overflow-y-auto [scrollbar-gutter:stable] rounded-t-2xl will-change-transform transition duration-300 ease-out data-closed:translate-y-full"
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
                placeholder="Masukkan nama stasiun atau kode stasiun"
                value={query}
                onChange={e => setQuery(e.target.value)}
                aria-label="Cari stasiun berdasarkan nama atau kode"
              />
            </div>
            {operators.length > 1
              ? (
                  <div className="mt-3 -mx-8 px-8 flex gap-2 overflow-x-auto no-scrollbar" role="group" aria-label="Saring berdasarkan operator">
                    <button
                      type="button"
                      onClick={() => setOperatorFilter(null)}
                      aria-pressed={operatorFilter === null}
                      className={`shrink-0 rounded-full px-3.5 py-1.5 text-sm font-semibold border-2 cursor-pointer transition-colors duration-150 ${operatorFilter === null ? 'bg-rose-100 text-pink-800 border-rose-200' : 'bg-white text-slate-500 border-stone-200/70'}`}
                    >
                      Semua
                    </button>
                    {operators.map(operator => (
                      <button
                        key={operator.code}
                        type="button"
                        onClick={() => setOperatorFilter(current => (current === operator.code ? null : operator.code))}
                        aria-pressed={operatorFilter === operator.code}
                        className={`shrink-0 rounded-full px-3.5 py-1.5 text-sm font-semibold border-2 cursor-pointer transition-colors duration-150 ${operatorFilter === operator.code ? 'bg-rose-100 text-pink-800 border-rose-200' : 'bg-white text-slate-500 border-stone-200/70'}`}
                      >
                        { operator.name }
                      </button>
                    ))}
                  </div>
                )
              : null}
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
                        {station.lines?.length
                          ? (
                              <span className="flex -space-x-1.5">
                                {sortLinesForDisplay(station.lines, station.operator, sortLineKeysForDisplay).map(line => (
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
              ? <li className="px-8 py-10 text-center text-slate-400">Tidak ada stasiun yang cocok</li>
              : null}
          </ul>
        </DialogPanel>
      </div>
    </Dialog>
  )
}
