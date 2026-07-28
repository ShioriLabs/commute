import type { ReactNode } from 'react'
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router'
import type { Line } from 'models/line'
import { getForegroundColor, getTintFromColor } from 'utils/colors'
import LineRoundel from '~/components/line-roundel'
import { filterBestTier, keywordScore, SCORE_THRESHOLD } from 'utils/fuzzy-match'
import type { Searchable } from 'models/searchable'
import { useSearchables } from '~/hooks/use-searchables'
import { CaretRightIcon } from '@phosphor-icons/react'
import clsx from 'clsx'
import { readRecents, recordRecent, type RecentEntry } from 'utils/recents'
import { buildFarePath } from 'utils/fare-url'
import { readSearchMode, writeSearchMode, type SearchMode } from 'utils/search-mode'
import FarePanel from '~/components/fare-sheet/fare-panel'
import { useFareQuery } from '~/components/fare-sheet/use-fare-query'
import SearchableItem from './searchable-item'
import SearchModeToggle from './mode-toggle'

// Horizontal card rail for the idle state. Resolves mixed station/hub entries
// against the prebuilt index (already fetched by the parent, so SWR serves this
// from cache), preserving the given order.
function HighlightedList({ title, items, searchables, className }: { title: string, items: RecentEntry[], searchables: Searchable<Line[]>[], className?: string }) {
  // Ids live in `data` — 'station-id' or 'hub-id', matching RecentEntry.type.
  const byId = useMemo(() => {
    const index = new Map<string, Searchable<Line[]>>()
    for (const searchable of searchables) {
      const id = searchable.data?.['station-id'] ?? searchable.data?.['hub-id']
      if (id) index.set(`${searchable.type}:${id}`, searchable)
    }
    return index
  }, [searchables])

  const cards = items
    .map((item) => {
      // The index already carries the display name (directional suffix stripped),
      // the subtitle, and the lines — everything a card renders.
      const searchable = byId.get(`${item.type}:${item.id}`)
      if (!searchable) return null
      return {
        key: `${item.type}:${item.id}`,
        to: searchable.to,
        name: searchable.title,
        subtitle: searchable.subtitle,
        line: searchable.body?.[0],
        operator: searchable.operator
      }
    })
    .filter(card => card !== null)

  if (cards.length === 0) {
    return null
  }

  return (
    <article className={`max-w-3xl mx-auto ${className}`}>
      <h1 className="text-xl font-bold mx-8">{ title }</h1>
      <ul
        className="mt-2 flex flex-row gap-4 overflow-auto pb-2 rounded-xl ps-8 pe-8 scroll-smooth no-scrollbar"
      >
        {cards.map(card => (
          <li key={card.key} className="shrink-0">
            <Link
              to={card.to}
              className={`flex flex-col gap-2 w-[54vw] lg:w-48 aspect-[3/4] p-4 rounded-xl shadow-sm ${card.line ? 'shadow-slate-900/15' : 'bg-rose-100 text-pink-800 shadow-pink-900/15'}`}
              style={card.line ? { backgroundColor: getTintFromColor(card.line.colorCode, 0.2, 'light'), color: card.line.colorCode } : undefined}
              replace
            >
              {card.line ? <LineRoundel size="SM" code={card.line.lineCode} color={card.line.colorCode} operator={card.operator} /> : null}
              <span className="font-semibold mt-auto">{ card.name }</span>
              <span className={card.line ? 'text-slate-700' : ''}>{ card.subtitle }</span>
            </Link>
          </li>
        ))}
      </ul>
    </article>
  )
}

const asStations = (ids: string[]): RecentEntry[] => ids.map(id => ({ type: 'STATION', id }))

// All rail lines as colored chips linking to their line pages, grouped in a
// single wrap. Fed by the index's LINE entries, which already exclude TJ (its
// line-detail pages aren't built yet — no topology).
function LineChipList({ searchables, className }: { searchables: Searchable<Line[]>[], className?: string }) {
  const lines = searchables.filter(searchable => searchable.type === 'LINE')

  if (lines.length === 0) return null

  return (
    <article className={`max-w-3xl mx-auto ${className}`}>
      <h1 className="text-xl font-bold mx-8">Lin</h1>
      <ul className="mt-2 flex flex-row flex-wrap gap-2 px-8">
        {lines.map((searchable) => {
          const line = searchable.body?.[0]
          if (!line) return null
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
  // Station mode is the correct first paint on the server and for a first-time
  // visitor, so the stored preference is read after mount (see the same pattern
  // in app/hooks/secret-features.ts useMapUnlock).
  const [mode, setMode] = useState<SearchMode>('STATION')
  // The fare panel mounts on first entry to route mode and then stays mounted,
  // hidden — toggling away and back must not lose the chosen station pair.
  const [fareMounted, setFareMounted] = useState(false)
  // No initialPair and no onPairChange: this surface never reads or writes
  // `?from=&to=`. Only /fare does, because only /fare is SEO-decorated.
  const fareQuery = useFareQuery()
  const fareSharePath = buildFarePath(fareQuery.origin?.id, fareQuery.destination?.id)

  const handleModeChange = (next: SearchMode) => {
    setMode(next)
    writeSearchMode(next)
    if (next === 'FARE') setFareMounted(true)
  }
  const searchInputRef = useRef<HTMLInputElement>(null)

  const filteredSearchables = useMemo(() => {
    if (searchables.length === 0 || deferredQuery.length < 2) return []
    const query = deferredQuery.toLowerCase()

    const scoredStations = searchables.map((searchable) => {
      let score = Infinity
      const keywords = searchable.keywords
      for (const keyword of keywords) {
        if (score === 0) break

        const keywordMatch = keywordScore(keyword, query)
        if (keywordMatch < score) score = keywordMatch
      }

      const popularityFactor = (searchable.score ?? 0) / 100
      const finalScore = score + (1 - popularityFactor)
      // Sub-unit ranking nudge applied only at sort time (NOT folded into
      // finalScore, so it can't push a borderline result past SCORE_THRESHOLD and
      // hide it). Always < 1, so it only reorders otherwise-close matches — never
      // lifts a poor match above a clearly better one. Prefer stations over
      // lines/hubs, and rail over TJ within stations.
      const isStation = searchable.type === 'STATION'
      const isTJ = isStation && searchable.operator === 'TJ'
      const sortNudge = (isStation ? 0 : 0.4) + (isTJ ? 0.2 : 0)

      return {
        ...searchable,
        score: finalScore,
        matchScore: score,
        sortNudge
      }
    }).filter((station) => {
      return station.score < SCORE_THRESHOLD
    })

    // Corrections are a fallback: exact matches hide typo matches, word-typo
    // matches hide window matches.
    return filterBestTier(scoredStations, station => station.matchScore)
      .sort((a, b) => (a.score + a.sortNudge) - (b.score + b.sortNudge) || a.title.localeCompare(b.title))
  }, [deferredQuery, searchables])

  useEffect(() => {
    setRecentlySearched(readRecents())
    setSavedStations(JSON.parse(localStorage.getItem('saved-stations') ?? '[]') as string[])
    const stored = readSearchMode()
    if (stored === 'FARE') {
      setMode('FARE')
      setFareMounted(true)
    }
  }, [])

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

  // scrollbar-gutter: results grow and shrink per keystroke; without the
  // reserved gutter the whole sheet shifts sideways each time the list
  // crosses one screen tall on classic-scrollbar platforms.
  return (
    <section className="bg-white w-screen h-full overflow-y-auto pb-4 [scrollbar-gutter:stable]">
      <div className="p-8 pb-4 sticky top-0 max-w-3xl mx-auto bg-white">
        <div className="flex gap-4 items-center justify-between">
          { title }
          { closeButton }
        </div>
        <SearchModeToggle mode={mode} onChange={handleModeChange} />
        {mode === 'STATION'
          ? (
              <input
                id="search-input"
                className="mt-4 w-full px-4 py-2 rounded-xl bg-stone-100/80 border-2 border-stone-200/40 focus:outline-stone-300/60"
                type="text"
                placeholder="Mau cari apa?"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                aria-label="Cari sesuatu berdasarkan kata kunci"
                ref={searchInputRef}
              />
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
                      <Link
                        to={fareSharePath}
                        className="mt-4 flex items-center justify-center gap-2 w-full px-4 py-3 rounded-xl bg-stone-100/80 border-2 border-stone-200/40 font-bold cursor-pointer"
                      >
                        Buka halaman tarif
                        <CaretRightIcon weight="bold" className="w-4 h-4" />
                      </Link>
                    )
                  : null}
              />
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
        {searchQuery.length < 2
          ? (
              <>
                {recentlySearched.length > 0
                  ? <HighlightedList title="Stasiun Terakhir Dicari" items={recentlySearched} searchables={searchables} className="mt-4" />
                  : null}
                {savedStations.length > 0
                  ? <HighlightedList title="Stasiun Tersimpan" items={asStations(savedStations)} searchables={searchables} className="mt-2" />
                  : null}
                <HighlightedList title="Stasiun Transit" items={asStations(['KCI-MRI', 'KCI-SUD', 'MRTJ-DKA', 'KCI-DU', 'KCI-THB'])} searchables={searchables} className="mt-2" />
                <HighlightedList title="Jakselcore" items={asStations(['KCI-TEB', 'MRTJ-BLM', 'MRTJ-IST', 'KCI-SUD', 'MRTJ-DKA'])} searchables={searchables} className="mt-2" />
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
