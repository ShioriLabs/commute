import type { Station } from 'models/stations'
import type { StandardResponse } from '@schema/response'
import type { Route } from './+types/search'
import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { XMarkIcon } from '@heroicons/react/24/outline'
import useSWR from 'swr'
import { fetcher } from 'utils/fetcher'

export default function SearchPage({ loaderData }: Route.ComponentProps) {
  const { data: stations, isLoading } = useSWR<StandardResponse<Station[]>>(new URL('/stations', import.meta.env.VITE_API_BASE_URL).href, fetcher)
  const [searchQuery, setSearchQuery] = useState<string>("")

  const filteredStations = useMemo(() => {
    if (stations?.data === undefined || searchQuery.length < 2) return []
    return stations.data.filter(
      station =>
        station.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        station.formattedName?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        station.code.toLowerCase().includes(searchQuery.toLowerCase())
    )
  }, [searchQuery])

  return (
    <main className="bg-white w-full min-h-screen">
      <div className="p-8 pb-4 sticky top-0 max-w-3xl mx-auto">
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
