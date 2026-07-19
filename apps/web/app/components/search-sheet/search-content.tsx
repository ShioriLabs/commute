import type { Station } from 'models/stations'
import type { Hub } from 'models/hub'
import type { OperatorWithLines } from 'models/operator'
import type { StandardResponse } from '@schema/response'
import type { ReactNode } from 'react'
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router'
import useSWR from 'swr'
import type { Line } from 'models/line'
import { fetcher } from 'utils/fetcher'
import { getForegroundColor, getTintFromColor } from 'utils/colors'
import LineRoundel from '~/components/line-roundel'
import { filterBestTier, keywordScore, SCORE_THRESHOLD } from 'utils/fuzzy-match'
import type { Searchable } from 'models/searchable'
import { hubToSearchable, lineToSearchable } from 'utils/searchables'
import { readRecents, recordRecent, type RecentEntry } from 'utils/recents'
import SearchableItem from './searchable-item'

const swrConfig = {
  dedupingInterval: import.meta.env.DEV ? 0 : 60 * 60 * 1000,
  focusThrottleInterval: import.meta.env.DEV ? 0 : 60 * 60 * 1000,
  revalidateOnFocus: true,
  shouldRetryOnError: false
}

// Horizontal card rail for the idle state. Resolves mixed station/hub entries
// against /stations and /hubs (SWR dedupes with the main fetches), preserving
// the given order.
function HighlightedList({ title, items, className }: { title: string, items: RecentEntry[], className?: string }) {
  const { data: stations } = useSWR<StandardResponse<Station[]>>(new URL('/stations', import.meta.env.VITE_API_BASE_URL).href, fetcher, swrConfig)
  const { data: hubs } = useSWR<StandardResponse<Hub[]>>(new URL('/hubs', import.meta.env.VITE_API_BASE_URL).href, fetcher, swrConfig)

  const cards = items
    .map((item) => {
      if (item.type === 'HUB') {
        const hub = hubs?.data?.find(hub => hub.slug === item.id)
        if (!hub) return null
        return {
          key: `HUB:${hub.slug}`,
          to: `/hubs/${hub.slug}`,
          name: hub.name,
          subtitle: 'Stasiun Terintegrasi',
          line: hub.lines[0] as Line | undefined,
          operator: undefined as string | undefined
        }
      }
      const station = stations?.data?.find(station => station.id === item.id)
      if (!station) return null
      return {
        key: `STATION:${station.id}`,
        to: `/stations/${station.operator.code}/${station.code}`,
        name: station.formattedName || station.name,
        subtitle: station.operator.name,
        line: station.lines[0] as Line | undefined,
        operator: station.operator.code as string | undefined
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
// single wrap. Fed by /operators (which embeds each operator's lines).
function LineChipList({ className }: { className?: string }) {
  const { data: operators } = useSWR<StandardResponse<OperatorWithLines[]>>(
    new URL('/operators', import.meta.env.VITE_API_BASE_URL).href,
    fetcher,
    swrConfig
  )

  if (!operators?.data?.length) return null

  return (
    <article className={`max-w-3xl mx-auto ${className}`}>
      <h1 className="text-xl font-bold mx-8">Lin</h1>
      <ul className="mt-2 flex flex-row flex-wrap gap-2 px-8">
        {/* TJ excluded: its line-detail pages aren't built yet (no topology). */}
        {operators.data.filter(op => op.code !== 'TJ').flatMap(op => op.lines.map(line => (
          <li key={`${op.code}-${line.lineCode}`}>
            <Link
              to={`/lines/${op.code}/${line.lineCode}`}
              className={`block text-sm font-semibold px-3 py-1 rounded-full ${getForegroundColor(line.colorCode) === 'LIGHT' ? 'text-white' : 'text-slate-900'}`}
              style={{ backgroundColor: line.colorCode }}
              replace
            >
              {line.name.replace(/Lin /g, '')}
            </Link>
          </li>
        )))}
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
  const { data: stations, isLoading } = useSWR<StandardResponse<Station[]>>(new URL('/stations', import.meta.env.VITE_API_BASE_URL).href, fetcher, swrConfig)
  const { data: hubs } = useSWR<StandardResponse<Hub[]>>(new URL('/hubs', import.meta.env.VITE_API_BASE_URL).href, fetcher, swrConfig)
  const { data: operators } = useSWR<StandardResponse<OperatorWithLines[]>>(new URL('/operators', import.meta.env.VITE_API_BASE_URL).href, fetcher, swrConfig)
  const [searchQuery, setSearchQuery] = useState<string>('')
  // Keep the input instant while the fuzzy filter runs against a
  // lower-priority, deferred copy of the query — the index is several hundred
  // searchables and scoring every keystroke synchronously was janking the field.
  const deferredQuery = useDeferredValue(searchQuery)
  const [recentlySearched, setRecentlySearched] = useState<RecentEntry[]>([])
  const [savedStations, setSavedStations] = useState<string[]>([])
  const searchInputRef = useRef<HTMLInputElement>(null)

  const searchables = useMemo(() => {
    const _searchables: Searchable[] = []
    if (stations && stations.data) {
      for (const station of stations.data) {
        if (station.regionCode !== 'CGK') continue // only jakarta area for now
        if (!station.searchable) continue // topology-only stations never enter the index
        _searchables.push({
          type: 'STATION',
          title: station.formattedName || station.name,
          subtitle: station.operator.name,
          to: `/stations/${station.operator.code}/${station.code}`,
          keywords: [
            station.name.toLowerCase(),
            station.code.toLowerCase(),
            ...(station.formattedName ? [station.formattedName.toLowerCase()] : [])
          ],
          body: station.lines,
          data: {
            'station-id': station.id
          },
          score: station.score ?? 0
        })
      }
    }

    if (hubs && hubs.data) {
      for (const hub of hubs.data) {
        _searchables.push(hubToSearchable(hub))
      }
    }

    if (operators && operators.data) {
      for (const operator of operators.data) {
        // TJ excluded: its line-detail pages aren't built yet (no topology).
        if (operator.code === 'TJ') continue
        for (const line of operator.lines) {
          _searchables.push(lineToSearchable(operator, line))
        }
      }
    }

    return _searchables
  }, [stations, hubs, operators])

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
      const isTJ = isStation && searchable.to.startsWith('/stations/TJ/')
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
  }, [])

  useEffect(() => {
    setTimeout(() => {
      if (searchInputRef.current) {
        searchInputRef.current.focus()
      }
    }, 250)
  }, [searchInputRef])

  // Stable identity so memoized SearchableItem rows don't re-render per keystroke.
  const handleSearchClick = useCallback((e: React.MouseEvent<HTMLAnchorElement>) => {
    const { stationId, hubId } = e.currentTarget.dataset
    if (stationId) {
      recordRecent({ type: 'STATION', id: stationId })
    } else if (hubId) {
      recordRecent({ type: 'HUB', id: hubId })
    }
  }, [])

  return (
    <section className="bg-white w-screen h-full overflow-y-auto pb-4">
      <div className="p-8 pb-4 sticky top-0 max-w-3xl mx-auto bg-white">
        <div className="flex gap-4 items-center justify-between">
          { title }
          { closeButton }
        </div>
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
      </div>
      {searchQuery.length < 2
        ? (
            <>
              {recentlySearched.length > 0
                ? <HighlightedList title="Stasiun Terakhir Dicari" items={recentlySearched} className="mt-4" />
                : null}
              {savedStations.length > 0
                ? <HighlightedList title="Stasiun Tersimpan" items={asStations(savedStations)} className="mt-2" />
                : null}
              <HighlightedList title="Stasiun Transit" items={asStations(['KCI-MRI', 'KCI-SUD', 'MRTJ-DKA', 'KCI-DU', 'KCI-THB'])} className="mt-2" />
              <HighlightedList title="Jakselcore" items={asStations(['KCI-TEB', 'MRTJ-BLM', 'MRTJ-IST', 'KCI-SUD', 'MRTJ-DKA'])} className="mt-2" />
              <LineChipList className="mt-6 pb-8" />
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
    </section>
  )
}
