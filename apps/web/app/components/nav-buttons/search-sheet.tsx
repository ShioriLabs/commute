import type { Station } from 'models/stations'
import type { StandardResponse } from '@schema/response'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router'
import { XMarkIcon } from '@heroicons/react/24/outline'
import useSWR from 'swr'
import { fetcher } from 'utils/fetcher'
import { levenshteinDistance } from 'utils/levenshtein'
import { CloseButton, DialogTitle } from '@headlessui/react'
import { getForegroundColor } from 'utils/colors'

function HighlightedStationList({ title, stationIDs, className }: { title: string, stationIDs: string[], className?: string }) {
  const { data: stations, isLoading } = useSWR<StandardResponse<Station[]>>(new URL('/stations', import.meta.env.VITE_API_BASE_URL).href, fetcher)

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
            <Link to={`/station/${station.operator.code}/${station.code}`} className="flex flex-col gap-2 w-[54vw] lg:w-48 aspect-[3/4] bg-rose-100 p-4 rounded-xl text-pink-800 shadow-sm shadow-pink-900/15">
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
  const { data: stations, isLoading } = useSWR<StandardResponse<Station[]>>(new URL('/stations', import.meta.env.VITE_API_BASE_URL).href, fetcher)
  const [searchQuery, setSearchQuery] = useState<string>('')
  const [recentlySearched, setRecentlySearched] = useState<string[]>([])
  const searchInputRef = useRef<HTMLInputElement>(null)

  const filteredStations = useMemo(() => {
    if (stations?.data === undefined || searchQuery.length < 2) return []
    const levThreshold = 3
    const query = searchQuery.toLowerCase()

    const scoredStations = stations.data.map((station) => {
      const name = station.name.toLowerCase()
      const formattedName = station.formattedName?.toLowerCase() ?? ''
      const code = station.code.toLowerCase()

      let score = Infinity

      if (name.includes(query) || formattedName.includes(query) || code.includes(query)) {
        score = 0
      } else {
        score = Math.min(
          levenshteinDistance(name, query),
          levenshteinDistance(formattedName, query),
          levenshteinDistance(code, query)
        )
      }
      return {
        ...station,
        score
      }
    }).filter((station) => {
      const score = station.score
      return score < levThreshold
    }).sort((a, b) => {
      const aScore = a.score
      const bScore = b.score
      if (aScore === bScore) {
        return a.name.localeCompare(b.name)
      }
      return aScore - bScore
    })

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
    }, 350)
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
          <DialogTitle className="font-bold text-2xl">Cari Stasiun</DialogTitle>
          <CloseButton
            aria-label="Tutup halaman pencarian"
            className="rounded-full leading-0 flex items-center justify-center w-8 h-8 cursor-pointer"
            aria-expanded="false"
            aria-controls="search-input"
          >
            <XMarkIcon />
          </CloseButton>
        </div>
        <input
          id="search-input"
          className="mt-4 w-full px-4 py-2 rounded-xl bg-stone-100/80 border-2 border-stone-200/40 focus:outline-stone-300"
          type="text"
          placeholder="Masukkan nama stasiun atau kode stasiun"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          aria-label="Cari stasiun berdasarkan nama atau kode"
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
      {filteredStations.length > 0
        ? (
            <ul className="mt-4 max-w-3xl mx-auto">
              {filteredStations.map(station => (
                <li key={station.id}>
                  <Link to={`/station/${station.operator.code}/${station.code}`} className="px-8 py-4 flex flex-col gap-1 min-h-24 text-lg" data-station-id={station.id} onClick={handleSearchClick}>
                    <b>
                      { station.formattedName }
                      &nbsp;&nbsp;
                      <span className="text-sm font-semibold text-gray-600">{station.operator.name}</span>
                    </b>
                    { station.lines.length > 0
                      ? (
                          <ul className="flex flex-row gap-1 flex-wrap">
                            {station.lines.map(line => (
                              <li key={line.lineCode} className={`text-sm font-semibold px-2.5 py-1 rounded-full text-stone-800 ${getForegroundColor(line.colorCode) === 'LIGHT' ? 'text-white' : 'text-slate-900'}`} style={{ backgroundColor: line.colorCode }}>
                                {line.name.replace(/Lin /g, '')}
                              </li>
                            ))}
                          </ul>
                        )
                      : null}
                  </Link>
                </li>
              ))}
            </ul>
          )
        : null}
      {searchQuery.length >= 2 && filteredStations.length === 0
        ? (
            <div className="w-full h-auto flex items-center justify-center mt-8 flex-col max-w-3xl mx-auto">
              <picture>
                <source src="/img/search_empty.webp" type="image/webp" />
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
