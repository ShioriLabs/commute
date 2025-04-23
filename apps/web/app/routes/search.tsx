import type { Station } from '@schema/stations'
import type { StandardResponse } from '@schema/response'
import type { Route } from './+types/search'
import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { XMarkIcon } from '@heroicons/react/24/outline'

export async function clientLoader(): Promise<StandardResponse<Station[]>> {
  const stations = await fetch(new URL('/stations', import.meta.env.VITE_API_BASE_URL))
  if (stations.ok) return await stations.json()
  return {
    status: 200,
    data: []
  }
}

export default function Search({ loaderData }: Route.ComponentProps) {
  const stations = loaderData
  const [searchQuery, setSearchQuery] = useState<string>("")

  const filteredStations = useMemo(() => {
    if (stations.data === undefined || searchQuery.length < 2) return []
    return stations.data.filter(
      station =>
        station.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        station.formattedName?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        station.code.toLowerCase().includes(searchQuery.toLowerCase())
    )
  }, [searchQuery])

  return (
    <main className="bg-white w-screen min-h-screen">
      <div className="p-8 pb-4 sticky top-0">
        <div className="flex gap-4 items-center justify-between">
          <h1 className="font-bold text-2xl">Cari Stasiun</h1>
          <button onClick={() => history.back()} aria-label="Close search page" className="rounded-full leading-0 flex items-center justify-center w-8 h-8">
            <XMarkIcon />
          </button>
        </div>
        <input
          className="mt-4 w-full px-4 py-2 rounded bg-stone-100 border-2 border-stone-200"
          type="text"
          placeholder="Masukkan nama stasiun atau kode stasiun"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>
      {filteredStations.length > 0 ? (
        <ul className="mt-4">
          {filteredStations.map(station => (
              <li key={station.code}>
                <Link to={`/station/${station.operator}/${station.code}`} className="px-8 py-4 flex flex-col gap-1">
                  <b>{ station.formattedName }</b>
                  <span className="font-semibold">{ station.operator }</span>
                </Link>
              </li>
            ))}
        </ul>
      ) : null}
    </main>
  )
}
