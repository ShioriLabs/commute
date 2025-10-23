import type { Station } from 'models/stations'
import type { StandardResponse } from '@schema/response'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router'
import { XIcon } from '@phosphor-icons/react'
import useSWR from 'swr'
import { fetcher } from 'utils/fetcher'
import { levenshteinDistance } from 'utils/levenshtein'
import { CloseButton, DialogTitle } from '@headlessui/react'
import type { Searchable } from 'models/searchable'
import SearchableItem from './searchable-item'

const SCORE_THRESHOLD = 3
const swrConfig = {
  dedupingInterval: import.meta.env.DEV ? 0 : 60 * 60 * 1000,
  focusThrottleInterval: import.meta.env.DEV ? 0 : 60 * 60 * 1000,
  revalidateOnFocus: true,
  shouldRetryOnError: false
}

function HighlightedStationList({ title, stationIDs, className }: { title: string, stationIDs: string[], className?: string }) {
  const { data: stations, isLoading } = useSWR<StandardResponse<Station[]>>(new URL('/stations', import.meta.env.VITE_API_BASE_URL).href, fetcher, swrConfig)

  if (isLoading || stations === undefined || stations.data === undefined) {
    return null
  }

  const filteredStations = stations.data
    .filter(station => stationIDs.includes(station.id))
    .sort((a, b) => {
      const aIndex = stationIDs.indexOf(a.id)
      const bIndex = stationIDs.indexOf(b.id)
      return aIndex - bIndex
    })

  if (filteredStations.length === 0) {
    return null
  }

  return (
    <article className={`max-w-3xl mx-auto ${className}`}>
      <h1 className="text-xl font-bold mx-8">{ title }</h1>
      <ul
        className="mt-2 flex flex-row gap-4 overflow-auto pb-2 rounded-xl ps-8 pe-8 scroll-smooth no-scrollbar"
      >
        {filteredStations.map(station => (
          <li key={station.id} className="shrink-0">
            <Link
              to={`/station/${station.operator.code}/${station.code}`}
              className="flex flex-col gap-2 w-[54vw] lg:w-48 aspect-[3/4] bg-rose-100 p-4 rounded-xl text-pink-800 shadow-sm shadow-pink-900/15"
              replace
            >
              <span className="font-semibold mt-auto">{ station.formattedName }</span>
              <span>{ station.operator.name }</span>
            </Link>
          </li>
        ))}
      </ul>
    </article>
  )
}

export default function SearchSheet() {
  const { data: stations, isLoading } = useSWR<StandardResponse<Station[]>>(new URL('/stations', import.meta.env.VITE_API_BASE_URL).href, fetcher, swrConfig)
  const [searchQuery, setSearchQuery] = useState<string>('')
  const [recentlySearched, setRecentlySearched] = useState<string[]>([])
  const searchInputRef = useRef<HTMLInputElement>(null)

  const searchables = useMemo(() => {
    const _searchables: Searchable[] = []
    if (stations && stations.data) {
      for (const station of stations.data) {
        if (station.regionCode !== 'CGK') continue // only jakarta area for now
        _searchables.push({
          type: 'STATION',
          title: station.formattedName || station.name,
          subtitle: station.operator.name,
          to: `/station/${station.operator.code}/${station.code}`,
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

    return _searchables
  }, [stations])

  const filteredSearchables = useMemo(() => {
    if (searchables.length === 0 || searchQuery.length < 2) return []
    const query = searchQuery.toLowerCase()

    const scoredStations = searchables.map((searchable) => {
      let score = Infinity
      const keywords = searchable.keywords
      for (const keyword of keywords) {
        if (score === 0) break

        if (keyword.includes(query)) {
          score = 0
        }

        const levScore = levenshteinDistance(keyword, query)
        if (levScore < score) score = levScore
      }

      const popularityFactor = (searchable.score ?? 0) / 100
      const finalScore = score + (1 - popularityFactor)

      return {
        ...searchable,
        score: finalScore
      }
    }).filter((station) => {
      return station.score < SCORE_THRESHOLD
    }).sort((a, b) => a.score - b.score || a.title.localeCompare(b.title))

    return scoredStations
  }, [searchQuery])

  useEffect(() => {
    const recentlySearchedString = localStorage.getItem('recently-searched') ?? '[]'
    const recent = JSON.parse(recentlySearchedString) as string[]
    setRecentlySearched(recent)
  }, [])

  useEffect(() => {
    setTimeout(() => {
      if (searchInputRef.current) {
        searchInputRef.current.focus()
      }
    }, 250)
  }, [searchInputRef])

  const handleSearchClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    const stationId = e.currentTarget.dataset.stationId
    if (!stationId) return

    const recentlySearchedString = localStorage.getItem('recently-searched') ?? '[]'
    const recent = JSON.parse(recentlySearchedString) as string[]

    // insert into first item, and remove > 3
    const newRecentlySearched = [stationId, ...recent.filter(item => item !== stationId)]
    if (newRecentlySearched.length > 3) {
      newRecentlySearched.pop()
    }

    localStorage.setItem('recently-searched', JSON.stringify(newRecentlySearched))
  }

  return (
    <section className="bg-white w-screen h-full overflow-y-auto pb-4">
      <div className="p-8 pb-4 sticky top-0 max-w-3xl mx-auto bg-white">
        <div className="flex gap-4 items-center justify-between">
          <DialogTitle className="font-bold text-2xl">Temukan</DialogTitle>
          <CloseButton
            aria-label="Tutup halaman pencarian"
            className="rounded-full leading-0 flex items-center justify-center w-8 h-8 cursor-pointer"
            aria-expanded="false"
            aria-controls="search-input"
          >
            <XIcon weight="bold" className="w-6 h-6" />
          </CloseButton>
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
                ? (
                    <>
                      <HighlightedStationList title="Stasiun Terakhir Dicari" stationIDs={recentlySearched} className="mt-4" />
                    </>
                  )
                : null}
              <HighlightedStationList title="Stasiun Transit" stationIDs={['KCI-MRI', 'KCI-SUD', 'MRTJ-DKA', 'KCI-DU', 'KCI-THB']} className="mt-2" />
              <HighlightedStationList title="Jakselcore" stationIDs={['KCI-TEB', 'MRTJ-BLM', 'MRTJ-IST', 'KCI-SUD', 'MRTJ-DKA']} className="mt-2" />
            </>
          )
        : null}
      {isLoading && searchQuery.length >= 2
        ? (
            <ul className="mt-4 max-w-3xl mx-auto">
              <li className="px-8 py-4">
                <div className="h-4 w-24 bg-slate" />
                <div className="mt-1 h-4 w-12" />
              </li>
              <li className="px-8 py-4">
                <div className="h-4 w-48 bg-slate" />
                <div className="mt-1 h-4 w-12" />
              </li>
              <li className="px-8 py-4">
                <div className="h-4 w-32 bg-slate" />
                <div className="mt-1 h-4 w-12" />
              </li>
            </ul>
          )
        : null}
      {filteredSearchables.length > 0
        ? (
            <ul className="mt-4 max-w-3xl mx-auto">
              {filteredSearchables.map(searchable => (
                <SearchableItem
                  key={`${searchable.type}:${searchable.to}`}
                  searchable={searchable}
                  onClick={handleSearchClick}
                />
              ))}
            </ul>
          )
        : null}
      {searchQuery.length >= 2 && filteredSearchables.length === 0
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
