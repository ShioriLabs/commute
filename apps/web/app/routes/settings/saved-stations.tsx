import { BookmarkIcon, BookmarkSlashIcon, ChevronLeftIcon } from '@heroicons/react/20/solid'
import type { StandardResponse } from '@schema/response'
import type { Station } from 'models/stations'
import { useState, useEffect, useCallback } from 'react'
import useSWR from 'swr'
import { fetcher } from 'utils/fetcher'

export function meta() {
  return [
    { title: 'Stasiun Tersimpan - Commute' },
    { name: 'theme-color', content: '#FFFFFF' }
  ]
}

function SavedStationItem({ stationId }: { stationId: string }) {
  const [operator, code] = stationId.split(/-/g)
  const station = useSWR<StandardResponse<Station>>(new URL(`/stations/${operator}/${code}`, import.meta.env.VITE_API_BASE_URL).href, fetcher)
  const [isSaved, setIsSaved] = useState(true)

  if (station.isLoading) {
    return (
      <li className="animate-pulse">
        <article>
          <div className="h-6 w-64 bg-slate-200 rounded" />
        </article>
      </li>
    )
  }

  if (station.error || station.data === undefined || station.data.data === undefined) {
    return null
  }

  const handleSaveStationButton = useCallback(() => {
    if (!station.data?.data?.id) return
    const savedStations = JSON.parse(localStorage.getItem('saved-stations') ?? '[]') as string[]

    if (!savedStations) {
      localStorage.setItem('saved-stations', JSON.stringify([station.data.data.id]))
      setIsSaved(true)
      return
    }

    if (savedStations.includes(station.data.data.id)) {
      const newSavedStations = savedStations.filter(item => item !== (station.data?.data?.id ?? ''))
      localStorage.setItem('saved-stations', JSON.stringify(newSavedStations))
      setIsSaved(false)
    } else {
      localStorage.setItem('saved-stations', JSON.stringify([...savedStations, station.data.data.id]))
      setIsSaved(true)
    }
  }, [station.data])

  return (
    <li>
      <article className="px-8 py-4 flex items-center gap-4 justify-between">
        <div>
          <h1 className="font-semibold text-lg flex">
            { station.data.data.formattedName }
          </h1>
          <h2 className="font-semibold text-sm text-slate-700">
            {station.data.data.operator.name}
          </h2>
        </div>
        <button onClick={handleSaveStationButton}>
          {isSaved
            ? (
                <BookmarkSlashIcon className="w-6 h-6 text-red-400" />
              )
            : (
                <BookmarkIcon className="w-6 h-6" />
              )}
        </button>
      </article>
    </li>
  )
}

export default function SettingsPage() {
  const [stations, setStations] = useState<string[]>([])
  const [isReady, setIsReady] = useState(false)

  useEffect(() => {
    const savedStationsRaw = localStorage.getItem('saved-stations')
    if (!savedStationsRaw) {
      localStorage.setItem('saved-stations', '[]')
      setIsReady(true)
      return
    }

    try {
      const parsedSavedStations = JSON.parse(savedStationsRaw)
      if (!(parsedSavedStations instanceof Array)) {
        localStorage.setItem('saved-stations', '[]')
        setIsReady(true)
        return
      }

      setStations(parsedSavedStations as string[])
      setIsReady(true)
    } catch (e) {
      if (e instanceof SyntaxError) {
        localStorage.setItem('saved-stations', '[]')
      }
      setIsReady(true)
    }
  }, [])

  return (
    <main className="bg-white w-screen h-full overflow-y-auto pb-4">
      <div className="p-8 pb-4 sticky top-0 max-w-3xl mx-auto bg-white">
        <div className="flex gap-3 items-center">
          <button
            aria-label="Kembali"
            className="rounded-full leading-0 flex items-center justify-center w-8 h-8 cursor-pointer"
            onClick={() => history.back()}
          >
            <ChevronLeftIcon />
          </button>
          <h1 className="font-bold text-2xl">Stasiun Disimpan</h1>
        </div>
      </div>
      {!isReady
        ? (
            <div className="flex items-center justify-center mt-8 p-8">
              <div className="rounded-full border-4 border-slate-600 border-t-transparent w-12 h-12 m-auto animate-spin" aria-label="Memuat data..." />
            </div>
          )
        : (
            <ul>
              {stations.length > 0
                ? (
                    stations.map(station => (
                      <SavedStationItem stationId={station} key={station} />
                    ))
                  )
                : (
                    <li>Tidak ada stasiun disimpan</li>
                  )}
            </ul>
          )}
    </main>
  )
}
