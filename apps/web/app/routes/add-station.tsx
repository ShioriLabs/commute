import type { Station } from '@schema/stations'
import type { StandardResponse } from '@schema/response'
import type { Route } from './+types/add-station'
import { useMemo, useState } from 'react'

export async function clientLoader(): Promise<StandardResponse<Station[]>> {
  const stations = await fetch(new URL('/stations', import.meta.env.VITE_API_BASE_URL))
  if (stations.ok) return await stations.json()
  return {
    status: 200,
    data: []
  }
}

export default function AddStation({ loaderData }: Route.ComponentProps) {
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
      <div className="p-8 pb-0">
        <h1 className="font-bold text-2xl">Cari Stasiun</h1>
        <input
          className="mt-4 w-full px-4 py-2 rounded bg-stone-200"
          type="text"
          placeholder="Masukkan nama stasiun atau kode stasiun"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>
      {filteredStations.length > 0 ? (
        <ul className="mt-8">
          {filteredStations.map(station => (
              <li className="px-8 py-4 flex flex-col gap-1">
                <b>{ station.formattedName }</b>
                <span className="font-semibold">{ station.operator }</span>
              </li>
            ))}
        </ul>
      ) : null}
    </div>
  )
}
