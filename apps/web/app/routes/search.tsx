import type { Station } from 'models/stations'
import type { StandardResponse } from '@schema/response'
import type { Route } from './+types/search'
import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { XMarkIcon } from '@heroicons/react/24/outline'
import useSWR from 'swr'
import { fetcher } from 'utils/fetcher'
import { levenshteinDistance } from 'utils/levenshtein'

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
        className="mt-2 flex flex-row gap-4 overflow-auto pb-2 rounded-lg ps-8 pe-8 scroll-smooth no-scrollbar"
      >
        {filteredStations.map(station => (
          <li key={station.id} className="shrink-0">
            <Link to={`/station/${station.operator.code}/${station.code}`} className="flex flex-col gap-2 w-[54vw] lg:w-48 aspect-[3/4] bg-lime-100 p-4 rounded-lg text-lime-900 shadow-sm shadow-lime-900/15">
              <span className="font-semibold mt-auto">{ station.formattedName }</span>
              <span>{ station.operator.name }</span>
            </Link>
          </li>
        ))}
      </ul>
    </article>
  )
}

export default function SearchPage({ loaderData }: Route.ComponentProps) {
  const { data: stations, isLoading } = useSWR<StandardResponse<Station[]>>(new URL('/stations', import.meta.env.VITE_API_BASE_URL).href, fetcher)
  const [searchQuery, setSearchQuery] = useState<string>("")

  const filteredStations = useMemo(() => {
    if (stations?.data === undefined || searchQuery.length < 2) return []
    const levThreshold = 3
    const query = searchQuery.toLowerCase()

    const scoredStations = stations.data.map(station => {
      const name = station.name.toLowerCase()
      const formattedName = station.formattedName?.toLowerCase() ?? ""
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
    }).filter(station => {
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

  return (
    <main className="bg-white w-full min-h-screen">
      <div className="p-8 pb-4 sticky top-0 max-w-3xl mx-auto bg-white">
        <div className="flex gap-4 items-center justify-between">
          <h1 className="font-bold text-2xl">Cari Stasiun</h1>
          <button onClick={() => history.back()} aria-label="Close search page" className="rounded-full leading-0 flex items-center justify-center w-8 h-8">
            <XMarkIcon />
          </button>
        </div>
        <input
          className="mt-4 w-full px-4 py-2 rounded bg-stone-100/80 border-2 border-stone-200/40 focus:outline-stone-300"
          type="text"
          placeholder="Masukkan nama stasiun atau kode stasiun"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>
      {searchQuery.length < 2 ? (
        <>
          <HighlightedStationList title="Stasiun Transit" stationIDs={["KCI-MRI", "KCI-SUD", "MRTJ-DKA", "KCI-DU", "KCI-THB"]} className="mt-4" />
          <HighlightedStationList title="Jakselcore" stationIDs={["KCI-TEB", "MRTJ-BLM", "MRTJ-IST", "KCI-SUD", "MRTJ-DKA"]} className="mt-2" />
        </>
      ) : null}
      {isLoading && searchQuery.length >= 2 ? (
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
      ) : null}
      {filteredStations.length > 0 ? (
        <ul className="mt-4 max-w-3xl mx-auto">
          {filteredStations.map(station => (
              <li key={station.code}>
                <Link to={`/station/${station.operator.code}/${station.code}`} className="px-8 py-4 flex flex-col gap-1">
                  <b>{ station.formattedName }</b>
                  <span className="font-semibold">{ station.operator.name }</span>
                </Link>
              </li>
            ))}
        </ul>
      ) : null}
    </main>
  )
}
