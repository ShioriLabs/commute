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

interface SavedStationItemProps {
  stationId: string
  isSaved: boolean
  onSaveButtonClick: (id: string) => void
}

interface SavedStationObject {
  id: string
  isSaved: boolean
}

function SavedStationItem({ stationId, isSaved, onSaveButtonClick }: SavedStationItemProps) {
  const [operator, code] = stationId.split(/-/g)
  const station = useSWR<StandardResponse<Station>>(new URL(`/stations/${operator}/${code}`, import.meta.env.VITE_API_BASE_URL).href, fetcher)

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
    onSaveButtonClick(stationId)
  }, [stationId])

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

export default function SavedStationsSettingsPage() {
  const [stations, setStations] = useState<SavedStationObject[]>([])
  const [isReady, setIsReady] = useState(false)
  const [isDirty, setIsDirty] = useState(false)

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

      setStations((parsedSavedStations as string[]).map(stat => ({ id: stat, isSaved: true })))
      setIsReady(true)
    } catch (e) {
      if (e instanceof SyntaxError) {
        localStorage.setItem('saved-stations', '[]')
      }
      setIsReady(true)
    }
  }, [])

  useEffect(() => {
    return () => {
      if (isDirty) {
        const committed = stations.filter(station => station.isSaved).map(station => station.id)
        localStorage.setItem('saved-stations', JSON.stringify(committed))
      }
    }
  }, [isDirty, stations])

  const handleSaveStationButton = (id: string) => {
    setStations(prevStations =>
      prevStations.map(station =>
        station.id === id
          ? { ...station, isSaved: !station.isSaved }
          : station
      )
    )

    setIsDirty(true)
  }

  return (
    <main className="bg-white w-screen h-full overflow-y-auto pb-4">
      <div className="p-8 pb-4 sticky top-0 max-w-3xl mx-auto bg-white">
        <div className="flex gap-3 items-center -ml-2">
          <button
            aria-label="Kembali"
            className="rounded-full leading-0 flex items-center justify-center w-8 h-8 cursor-pointer"
            onClick={() => history.back()}
          >
            <ChevronLeftIcon />
          </button>
          <h1 className="font-bold text-2xl">Stasiun Disimpan</h1>
        </div>
        <h2 className="mt-4 text-sm">Perubahan pada stasiun di bawah ini akan disimpan pada saat meninggalkan halaman ini</h2>
      </div>
      {!isReady
        ? (
            <div className="flex items-center justify-center mt-4 p-8">
              <div className="rounded-full border-4 border-slate-600 border-t-transparent w-12 h-12 m-auto animate-spin" aria-label="Memuat data..." />
            </div>
          )
        : (
            <ul>
              {stations.length > 0
                ? (
                    stations.map(station => (
                      <SavedStationItem
                        stationId={station.id}
                        key={station.id}
                        onSaveButtonClick={handleSaveStationButton}
                        isSaved={station.isSaved}
                      />
                    ))
                  )
                : (
                    <li className="px-8 py-4 font-bold">Tidak ada stasiun disimpan</li>
                  )}
            </ul>
          )}
    </main>
  )
}
