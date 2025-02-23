import type { Station } from '@schema/stations'
import type { StandardResponse } from '@schema/response'
import type { Route } from './+types/search'
import { useMemo, useState } from 'react'
import { Link } from 'react-router'

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
    <div>
      <div className="p-8 pb-4 sticky top-0 bg-white">
        <div className="flex gap-4 items-center justify-between">
          <h1 className="font-bold text-2xl">Cari Stasiun</h1>
          <button onClick={() => history.back()} aria-label="Close search page" className="rounded-full leading-0 flex items-center justify-center text-2xl font-bold w-10 h-10">
            &#x2715;
          </button>
        </div>
        <input
          className="mt-4 w-full px-4 py-2 rounded bg-stone-200 border-2 border-stone-300"
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
    </div>
  )
}
