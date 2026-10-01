import type { ReactNode } from 'react'
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router'
import { getForegroundColor, getTintFromColor } from 'utils/colors'
import { filterBestTier, keywordScore, popularityTerm, SCORE_THRESHOLD } from 'utils/fuzzy-match'
import type { Searchable } from '@commute/schemas'
import { useSearchables } from '~/hooks/use-searchables'
import { ArrowRightIcon, CaretRightIcon, MagnifyingGlassIcon, PencilSimpleIcon, PushPinIcon, XCircleIcon } from '@phosphor-icons/react'
import clsx from 'clsx'
import { clearRecentRoutes, clearRecents, readRecentRoutes, readRecents, recordRecent, type RecentEntry, type RecentRoute } from 'utils/recents'
import { entryKey, isSavedRoute, readSavedEntries, readSavedStations, toggleSavedRoute, toggleSavedStation } from 'utils/saved-stations'
import { buildFarePath } from 'utils/fare-url'
import { readSearchMode, writeSearchMode, type SearchMode } from 'utils/search-mode'
import FarePanel from '~/components/fare-sheet/fare-panel'
import SaveRouteButton from '~/components/fare-sheet/save-route-button'
import { useFareQuery } from '~/components/fare-sheet/use-fare-query'
import SearchableItem from './searchable-item'
import SearchModeToggle from './mode-toggle'
import { haptic } from 'utils/haptics'

// Resolves mixed station/hub entries against the prebuilt index (already
// fetched by the parent, so SWR serves this from cache), preserving the given
// order. Ids live in `data`: 'station-id' or 'hub-id', matching
// RecentEntry.type. Memoized because the idle state is gated on the live
// query, so it re-renders on the keystroke that opens a search.
function useResolved(items: RecentEntry[], searchables: Searchable[]) {
  const byId = useMemo(() => {
    const index = new Map<string, Searchable>()
    for (const searchable of searchables) {
      const id = searchable.data?.['station-id'] ?? searchable.data?.['hub-id']
      if (id) index.set(`${searchable.type}:${id}`, searchable)
    }
    return index
  }, [searchables])

  return useMemo(() => items
    .map(item => byId.get(`${item.type}:${item.id}`))
    .filter(searchable => searchable !== undefined), [items, byId])
}

const asStations = (ids: string[]): RecentEntry[] => ids.map(id => ({ type: 'STATION', id }))

// Pinned stations as shortcut pills under the field, TfL Go style. Tinted from
// each station's first line, like every other line-bearing surface. The
// trailing pencil goes to the settings page, the one place pins are reordered.
function SavedChips({ ids, searchables, onClick }: { ids: string[], searchables: Searchable[], onClick: (e: React.MouseEvent<HTMLAnchorElement>) => void }) {
  const entries = useMemo(() => asStations(ids), [ids])
  const saved = useResolved(entries, searchables)
  if (saved.length === 0) return null

  return (
    <ul className="mt-3 flex flex-row flex-wrap gap-2">
      {saved.map((searchable) => {
        const line = searchable.type === 'LINE' ? searchable.line : searchable.lines[0]
        const stationId = searchable.data?.['station-id']
        return (
          <li key={searchable.to}>
            <Link
              to={searchable.to}
              onClick={onClick}
              data-station-id={stationId}
              className="flex items-center gap-1.5 text-sm font-bold px-3 py-1.5 rounded-full"
              style={line
                ? { backgroundColor: getTintFromColor(line.colorCode, 0.2, 'light'), color: line.colorCode }
                : undefined}
              replace
            >
              <PushPinIcon weight="fill" className="w-4 h-4" />
              <span className={line ? 'text-slate-900' : undefined}>{searchable.title}</span>
            </Link>
          </li>
        )
      })}
      <li>
        <Link
          to="/settings/saved-stations"
          aria-label="Atur stasiun yang di-pin"
          className="flex items-center justify-center h-full px-3.5 py-1.5 rounded-full bg-stone-100/80 text-slate-700"
        >
          <PencilSimpleIcon weight="bold" className="w-4 h-4" />
        </Link>
      </li>
    </ul>
  )
}

function RecentList({ items, searchables, savedIds, onClick, onToggleSave, onClear }: {
  items: RecentEntry[]
  searchables: Searchable[]
  savedIds: ReadonlySet<string>
  onClick: (e: React.MouseEvent<HTMLAnchorElement>) => void
  onToggleSave: (e: React.MouseEvent<HTMLButtonElement>) => void
  onClear: () => void
}) {
  const recents = useResolved(items, searchables)
  if (recents.length === 0) return null

  return (
    <article className="mt-4 max-w-3xl mx-auto">
      <div className="flex items-center justify-between px-8">
        <h1 className="text-sm font-bold text-slate-500">Terakhir dicari</h1>
        <button type="button" onClick={onClear} className="text-sm font-bold text-[#F55875] cursor-pointer">
          Hapus
        </button>
      </div>
      <ul className="mt-1">
        {recents.map((searchable, index) => (
          <SearchableItem
            key={`${searchable.type}:${searchable.to}`}
            searchable={searchable}
            onClick={onClick}
            index={index}
            saved={savedIds.has(searchable.data?.['station-id'] ?? '')}
            onToggleSave={onToggleSave}
          />
        ))}
      </ul>
    </article>
  )
}

// Pairs checked on any fare surface, each a link to /fare with a pin that puts
// it on home. Shown only while route mode has no complete pair, where it reads
// as "pick up where you left off" rather than competing with a result.
function RecentRouteList({ routes, searchables, savedKeys, onToggleSave, onClear }: {
  routes: RecentRoute[]
  searchables: Searchable[]
  savedKeys: ReadonlySet<string>
  onToggleSave: (route: RecentRoute) => void
  onClear: () => void
}) {
  const names = useMemo(() => {
    const index = new Map<string, string>()
    for (const searchable of searchables) {
      const id = searchable.data?.['station-id']
      if (searchable.type === 'STATION' && id) index.set(id, searchable.title)
    }
    return index
  }, [searchables])
  const named = routes.filter(route => names.has(route.from) && names.has(route.to))
  if (named.length === 0) return null

  return (
    <article className="mt-6">
      <div className="flex items-center justify-between">
        <h1 className="text-sm font-bold text-slate-500">Rute terakhir</h1>
        <button type="button" onClick={onClear} className="text-sm font-bold text-[#F55875] cursor-pointer">
          Hapus
        </button>
      </div>
      <ul className="mt-1">
        {named.map((route) => {
          const saved = savedKeys.has(entryKey({ type: 'ROUTE', ...route }))
          const label = `${names.get(route.from)} ke ${names.get(route.to)}`
          return (
            <li key={`${route.from}>${route.to}`} className="flex items-center gap-2">
              <Link
                to={buildFarePath(route.from, route.to) ?? '/fare'}
                className="flex-grow min-w-0 py-3 flex items-center gap-2 font-semibold"
              >
                <span className="truncate">{names.get(route.from)}</span>
                <ArrowRightIcon weight="bold" className="w-4 h-4 shrink-0 text-slate-500" />
                <span className="truncate">{names.get(route.to)}</span>
              </Link>
              <button
                type="button"
                onClick={() => onToggleSave(route)}
                aria-label={saved ? `Hapus rute ${label} dari beranda` : `Simpan rute ${label} ke beranda`}
                aria-pressed={saved}
                className="w-9 h-9 shrink-0 flex items-center justify-center cursor-pointer"
              >
                <PushPinIcon weight={saved ? 'fill' : 'bold'} className="w-6 h-6" />
              </button>
            </li>
          )
        })}
      </ul>
    </article>
  )
}

// All rail lines as colored chips linking to their line pages, grouped in a
// single wrap. Fed by the index's LINE entries, which already exclude TJ (its
// line-detail pages aren't built yet — no topology).
function LineChipList({ searchables, className }: { searchables: Searchable[], className?: string }) {
  // Memoized: this scans the whole index, and the idle state it belongs to is
  // gated on the live query — so without this it re-filtered every entry on the
  // keystroke that dismisses it.
  const lines = useMemo(
    () => searchables.filter(searchable => searchable.type === 'LINE'),
    [searchables]
  )

  if (lines.length === 0) return null

  return (
    <article className={`max-w-3xl mx-auto ${className}`}>
      <h1 className="text-sm font-bold text-slate-500 mx-8">Lin</h1>
      <ul className="mt-2 flex flex-row flex-wrap gap-2 px-8">
        {lines.map((searchable) => {
          const line = searchable.line
          return (
            <li key={searchable.to}>
              <Link
                to={searchable.to}
                className={`block text-sm font-semibold px-3 py-1 rounded-full ${getForegroundColor(line.colorCode) === 'LIGHT' ? 'text-white' : 'text-slate-900'}`}
                style={{ backgroundColor: line.colorCode }}
                replace
              >
                {line.name.replace(/Lin /g, '')}
              </Link>
            </li>
          )
        })}
      </ul>
    </article>
  )
}

interface Props {
  // Header slots so Dialog-bound components (DialogTitle, CloseButton) stay in
  // the sheet wrapper — this component must also render standalone on /search.
  title: ReactNode
  closeButton: ReactNode
}

export default function SearchContent({ title, closeButton }: Props) {
  // One request, already in `Searchable` shape — stations (directional pairs
  // folded), hubs and lines. Replaces the /stations + /hubs + /operators
  // fan-out this used to do, and the index it used to rebuild on every mount.
  const { searchables, isLoading } = useSearchables()
  const [searchQuery, setSearchQuery] = useState<string>('')
  // Keep the input instant while the fuzzy filter runs against a
  // lower-priority, deferred copy of the query — the index is several hundred
  // searchables and scoring every keystroke synchronously was janking the field.
  const deferredQuery = useDeferredValue(searchQuery)
  const [recentlySearched, setRecentlySearched] = useState<RecentEntry[]>([])
  const [savedStations, setSavedStations] = useState<string[]>([])
  const [recentRoutes, setRecentRoutes] = useState<RecentRoute[]>([])
  const [savedRouteKeys, setSavedRouteKeys] = useState<ReadonlySet<string>>(() => new Set())
  // Station mode is the correct first paint on the server and for a first-time
  // visitor, so the stored preference is read after mount (see the same pattern
  // in app/hooks/secret-features.ts useMapGlDebug).
  const [mode, setMode] = useState<SearchMode>('STATION')
  // The fare panel mounts on first entry to route mode and then stays mounted,
  // hidden — toggling away and back must not lose the chosen station pair.
  const [fareMounted, setFareMounted] = useState(false)
  // No initialPair and no onPairChange: this surface never reads or writes
  // `?from=&to=`. Only /fare does, because only /fare is SEO-decorated.
  const fareQuery = useFareQuery()
  const fareSharePath = buildFarePath(
    fareQuery.origin?.id,
    fareQuery.destination?.id,
    fareQuery.criteria
  )

  const pairComplete = !!fareQuery.pairFromId && !!fareQuery.pairToId
  useEffect(() => {
    // Re-read on each return to the empty state: the lookup just made, and any
    // pin set on its result, both happened while this list was hidden.
    if (mode !== 'FARE' || pairComplete) return
    setRecentRoutes(readRecentRoutes())
    setSavedRouteKeys(new Set(readSavedEntries().filter(isSavedRoute).map(entryKey)))
  }, [mode, pairComplete])

  const handleModeChange = (next: SearchMode) => {
    setMode(next)
    writeSearchMode(next)
    if (next === 'FARE') setFareMounted(true)
  }
  const searchInputRef = useRef<HTMLInputElement>(null)

  const filteredSearchables = useMemo(() => {
    if (searchables.length === 0 || deferredQuery.length < 2) return []
    const query = deferredQuery.toLowerCase()

    /*
     * Score first, wrap later: only the (few) matches below the threshold get
     * an object — not the whole index on every keystroke.
     *
     * The searchable is held by reference rather than spread into the wrapper.
     * Spreading gave every match a fresh identity each keystroke, which meant
     * SearchableItem's memo() could never bail out and its `dataset` memo
     * (keyed on `searchable.data`) re-ran for every visible row. The identity
     * is stable across keystrokes, so now they both hold.
     */
    const scoredStations: {
      searchable: Searchable
      score: number
      matchScore: number
      sortNudge: number
    }[] = []
    for (const searchable of searchables) {
      let score = Infinity
      const keywords = searchable.keywords
      for (const keyword of keywords) {
        if (score === 0) break

        const keywordMatch = keywordScore(keyword, query)
        if (keywordMatch < score) score = keywordMatch
      }

      const finalScore = score + (1 - popularityTerm(searchable.score))
      if (finalScore >= SCORE_THRESHOLD) continue

      // Sub-unit ranking nudge applied only at sort time (NOT folded into
      // finalScore, so it can't push a borderline result past SCORE_THRESHOLD and
      // hide it). Always < 1, so it only reorders otherwise-close matches — never
      // lifts a poor match above a clearly better one. Prefer stations over
      // lines/hubs, and rail over TJ within stations.
      const isStation = searchable.type === 'STATION'
      const isTJ = isStation && searchable.operator === 'TJ'
      const sortNudge = (isStation ? 0 : 0.4) + (isTJ ? 0.2 : 0)

      scoredStations.push({
        searchable,
        score: finalScore,
        matchScore: score,
        sortNudge
      })
    }

    // Corrections are a fallback: exact matches hide typo matches, word-typo
    // matches hide window matches.
    return filterBestTier(scoredStations, station => station.matchScore)
      .sort((a, b) => (a.score + a.sortNudge) - (b.score + b.sortNudge) || a.searchable.title.localeCompare(b.searchable.title))
      .map(({ searchable }) => searchable)
  }, [deferredQuery, searchables])

  useEffect(() => {
    setRecentlySearched(readRecents())
    setSavedStations(readSavedStations())
    setSavedRouteKeys(new Set(readSavedEntries().filter(isSavedRoute).map(entryKey)))
    const stored = readSearchMode()
    if (stored === 'FARE') {
      setMode('FARE')
      setFareMounted(true)
    }
  }, [])

  /*
   * The idle-state rails wait one frame before mounting.
   *
   * This sheet is opened by the homepage card's morph, and everything under it
   * mounts in the single commit that opens the dialog — measured at ~173ms at
   * 4x CPU, all of it landing before the transition even starts, which is where
   * that open's dropped frames came from. The input and the mode toggle are
   * what the tap was for; the rails below are not, and they carry the bulk of
   * the nodes.
   *
   * rAF rather than a timer: it yields exactly once, so the rails land on the
   * very next frame instead of at a guessed delay. Same idea as the fare
   * picker's INITIAL_ROWS/renderAll staging, one step instead of two.
   */
  const [railsMounted, setRailsMounted] = useState(false)
  useEffect(() => {
    const raf = requestAnimationFrame(() => setRailsMounted(true))
    return () => cancelAnimationFrame(raf)
  }, [])

  const savedIds = useMemo(() => new Set(savedStations), [savedStations])

  useEffect(() => {
    // Only in station mode: route mode renders no input, and the picker inside
    // FarePanel opens its own dialog — stealing focus back here 250ms later
    // would fight it.
    if (mode !== 'STATION') return
    const timer = setTimeout(() => {
      if (searchInputRef.current) {
        searchInputRef.current.focus()
      }
    }, 250)
    return () => clearTimeout(timer)
  }, [searchInputRef, mode])

  // Stable identity so memoized SearchableItem rows don't re-render per keystroke.
  const handleSearchClick = useCallback((e: React.MouseEvent<HTMLAnchorElement>) => {
    const { stationId, hubId } = e.currentTarget.dataset
    if (stationId) {
      recordRecent({ type: 'STATION', id: stationId })
    } else if (hubId) {
      recordRecent({ type: 'HUB', id: hubId })
    }
  }, [])

  // Stable for the same reason. The id rides on the button's dataset, and the
  // returned list is what storage now holds, so the pills follow at once.
  const handleToggleSave = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
    const { stationId } = e.currentTarget.dataset
    if (!stationId) return
    haptic()
    setSavedStations(toggleSavedStation(stationId))
  }, [])

  const handleToggleSaveRoute = useCallback((route: RecentRoute) => {
    haptic()
    toggleSavedRoute(route.from, route.to)
    setSavedRouteKeys(new Set(readSavedEntries().filter(isSavedRoute).map(entryKey)))
  }, [])

  const handleClearRecentRoutes = useCallback(() => {
    clearRecentRoutes()
    setRecentRoutes([])
  }, [])

  const handleClearRecents = useCallback(() => {
    clearRecents()
    setRecentlySearched([])
  }, [])

  // scrollbar-gutter: results grow and shrink per keystroke; without the
  // reserved gutter the whole sheet shifts sideways each time the list
  // crosses one screen tall on classic-scrollbar platforms.
  return (
    <section className="bg-white w-screen h-full overflow-y-auto pb-4 [scrollbar-gutter:stable]">
      {/* z-index matters twice here. `sticky` alone does not raise an element
          above later siblings, so without one the panel below scrolls *through*
          this header. And it has to beat z-[1], not merely have one: FarePanel's
          swap button carries z-[1] to sit above the two station fields it
          straddles, so a header at the same level loses to it on paint order and
          the button floats over the title. */}
      <div className="p-8 pb-4 sticky top-0 z-[2] max-w-3xl mx-auto bg-white">
        <div className="flex gap-4 items-center justify-between">
          { title }
          { closeButton }
        </div>
        <SearchModeToggle mode={mode} onChange={handleModeChange} />
        {mode === 'STATION'
          ? (
              <>
                <div className="mt-4 relative">
                  <MagnifyingGlassIcon weight="bold" className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400 pointer-events-none" />
                  <input
                    id="search-input"
                    className="w-full ps-11 pe-11 py-2 rounded-xl bg-stone-100/80 border-2 border-stone-200/40 focus:outline-stone-300/60"
                    type="text"
                    placeholder="Mau cari apa?"
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    aria-label="Cari sesuatu berdasarkan kata kunci"
                    ref={searchInputRef}
                  />
                  {searchQuery.length > 0
                    ? (
                        <button
                          type="button"
                          onClick={() => {
                            setSearchQuery('')
                            searchInputRef.current?.focus()
                          }}
                          aria-label="Hapus kata kunci"
                          className="absolute right-2 top-1/2 -translate-y-1/2 w-9 h-9 flex items-center justify-center text-slate-500 cursor-pointer"
                        >
                          <XCircleIcon weight="fill" className="w-6 h-6" />
                        </button>
                      )
                    : null}
                </div>
                {searchQuery.length < 2 && railsMounted
                  ? <SavedChips ids={savedStations} searchables={searchables} onClick={handleSearchClick} />
                  : null}
              </>
            )
          : null}
      </div>

      {/* Kept mounted once opened so a round trip through station mode doesn't
          discard the station pair — only hidden. */}
      {fareMounted
        ? (
            <div
              role="tabpanel"
              id="search-mode-panel-FARE"
              aria-labelledby="search-mode-tab-FARE"
              hidden={mode !== 'FARE'}
              className={clsx('px-8 pb-4 max-w-3xl mx-auto', mode !== 'FARE' && 'hidden')}
            >
              <FarePanel
                query={fareQuery}
                footer={fareSharePath
                  ? (
                      <div className="mt-4 flex gap-2">
                        <Link
                          to={fareSharePath}
                          className="flex-grow flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-stone-100/80 border-2 border-stone-200/40 font-bold cursor-pointer"
                        >
                          Buka halaman tarif
                          <CaretRightIcon weight="bold" className="w-4 h-4" />
                        </Link>
                        <SaveRouteButton
                          fromId={fareQuery.pairFromId}
                          toId={fareQuery.pairToId}
                          className="shrink-0 w-[52px] flex items-center justify-center rounded-xl bg-stone-100/80 border-2 border-stone-200/40 cursor-pointer"
                        />
                      </div>
                    )
                  : null}
              />
              {pairComplete
                ? null
                : (
                    <RecentRouteList
                      routes={recentRoutes}
                      searchables={searchables}
                      savedKeys={savedRouteKeys}
                      onToggleSave={handleToggleSaveRoute}
                      onClear={handleClearRecentRoutes}
                    />
                  )}
            </div>
          )
        : null}

      <div
        role="tabpanel"
        id="search-mode-panel-STATION"
        aria-labelledby="search-mode-tab-STATION"
        hidden={mode !== 'STATION'}
        className={clsx(mode !== 'STATION' && 'hidden')}
      >
        {searchQuery.length < 2 && railsMounted
          ? (
              <>
                <RecentList
                  items={recentlySearched}
                  searchables={searchables}
                  savedIds={savedIds}
                  onClick={handleSearchClick}
                  onToggleSave={handleToggleSave}
                  onClear={handleClearRecents}
                />
                {recentlySearched.length === 0 && savedStations.length === 0
                  ? <p className="mt-4 px-8 max-w-3xl mx-auto text-sm text-slate-500">Stasiun yang kamu cari bakal muncul di sini</p>
                  : null}
                <LineChipList searchables={searchables} className="mt-6 pb-8" />
              </>
            )
          : null}
        {isLoading && searchQuery.length >= 2
          ? (
              <ul className="mt-4 max-w-3xl mx-auto animate-pulse">
                <li className="px-8 py-4">
                  <div className="h-4 w-24 bg-slate-200 rounded" />
                  <div className="mt-2 h-3 w-12 bg-slate-200 rounded" />
                </li>
                <li className="px-8 py-4">
                  <div className="h-4 w-48 bg-slate-200 rounded" />
                  <div className="mt-2 h-3 w-12 bg-slate-200 rounded" />
                </li>
                <li className="px-8 py-4">
                  <div className="h-4 w-32 bg-slate-200 rounded" />
                  <div className="mt-2 h-3 w-12 bg-slate-200 rounded" />
                </li>
              </ul>
            )
          : null}
        {filteredSearchables.length > 0
          ? (
              <ul className="mt-4 max-w-3xl mx-auto">
                {filteredSearchables.map((searchable, index) => (
                  <SearchableItem
                    key={`${searchable.type}:${searchable.to}`}
                    searchable={searchable}
                    onClick={handleSearchClick}
                    // Deferred on purpose: passing the live query would force every
                    // row to re-render at urgent priority on each keystroke, blocking
                    // the input — the exact jank useDeferredValue exists to avoid.
                    // It also matches the list, which is filtered by deferredQuery.
                    query={deferredQuery}
                    index={index}
                    saved={savedIds.has(searchable.data?.['station-id'] ?? '')}
                    onToggleSave={handleToggleSave}
                  />
                ))}
              </ul>
            )
          : null}
        {deferredQuery.length >= 2 && filteredSearchables.length === 0
          ? (
              <div className="w-full h-auto flex items-center justify-center mt-8 flex-col max-w-3xl mx-auto">
                <picture>
                  <source srcSet="/img/search_empty.webp" type="image/webp" />
                  <img src="/img/search_empty.png" alt="Gambar peron stasiun dengan jembatan di atasnya, dengan kaca pembesar bergambar tanda tanya di depannya" className="w-48 h-48 aspect-square object-contain" />
                </picture>
                <span className="text-2xl text-center font-bold mt-0">Stasiun Tidak Ditemukan</span>
                <p className="text-center mt-2">
                  Coba cari dengan nama atau kode stasiun yang lain
                </p>
              </div>
            )
          : null}
      </div>
    </section>
  )
}
