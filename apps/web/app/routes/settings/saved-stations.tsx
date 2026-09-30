import { OPERATORS } from '@commute/constants'
import { CaretDownIcon, CaretLeftIcon, CaretUpIcon, PushPinIcon, PushPinSlashIcon } from '@phosphor-icons/react'
import type { StandardResponse } from '@schema/response'
import type { Station } from '@commute/schemas'
import { useState, useEffect, useCallback } from 'react'
import useSWR from 'swr'
import { fetcher } from 'utils/fetcher'
import { moveEntry } from 'utils/saved-stations'

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
  // Ends of the list disable the matching chevron rather than wrapping around.
  isFirst: boolean
  isLast: boolean
  onMove: (id: string, offset: -1 | 1) => void
}

interface SavedStationObject {
  id: string
  isSaved: boolean
}

function SavedStationItem({ stationId, isSaved, onSaveButtonClick, isFirst, isLast, onMove }: SavedStationItemProps) {
  const [operator, code] = stationId.split(/-/g)
  const station = useSWR<StandardResponse<Station>>(new URL(`/stations/${operator}/${code}`, import.meta.env.VITE_API_BASE_URL).href, fetcher)

  const handleSaveStationButton = useCallback(() => {
    onSaveButtonClick(stationId)
  }, [stationId, onSaveButtonClick])

  if (station.isLoading) {
    return (
      <li className="animate-pulse">
        <article className="px-8 py-4 flex items-center gap-4 justify-between">
          <div>
            <div className="h-4 w-64 bg-slate-200 rounded" />
            <div className="h-3 w-32 mt-1 bg-slate-200 rounded" />
          </div>
          <div className="w-6 h-6 bg-slate-200 rounded" />
        </article>
      </li>
    )
  }

  if (station.error || station.data === undefined || station.data.data === undefined) {
    return null
  }

  return (
    <li>
      <article className="px-8 py-4 flex items-center gap-4 justify-between">
        <div>
          <h1 className="font-semibold text-lg flex">
            { station.data.data.name }
          </h1>
          <h2 className="font-semibold text-sm text-slate-700">
            {OPERATORS[station.data.data.operator]?.name ?? station.data.data.operator}
          </h2>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={() => onMove(stationId, -1)}
            disabled={isFirst}
            aria-label={`Naikkan ${station.data.data.name}`}
            className="w-9 h-9 rounded-full flex items-center justify-center cursor-pointer disabled:cursor-default disabled:text-slate-300"
          >
            <CaretUpIcon weight="bold" className="w-5 h-5" />
          </button>
          <button
            type="button"
            onClick={() => onMove(stationId, 1)}
            disabled={isLast}
            aria-label={`Turunkan ${station.data.data.name}`}
            className="w-9 h-9 rounded-full flex items-center justify-center cursor-pointer disabled:cursor-default disabled:text-slate-300"
          >
            <CaretDownIcon weight="bold" className="w-5 h-5" />
          </button>
          <button onClick={handleSaveStationButton} className="ms-2 cursor-pointer">
            {isSaved
              ? (
                  <PushPinSlashIcon weight="fill" className="w-6 h-6 text-red-400" />
                )
              : (
                  <PushPinIcon weight="fill" className="w-6 h-6" />
                )}
          </button>
        </div>
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

  // Order is what the search sheet's pin pills follow, so a move is a change
  // like any other and commits on leaving the page.
  const handleMove = (id: string, offset: -1 | 1) => {
    setStations((prevStations) => {
      const from = prevStations.findIndex(station => station.id === id)
      return from === -1 ? prevStations : moveEntry(prevStations, from, from + offset)
    })
    setIsDirty(true)
  }

  return (
    <main className="bg-white w-full h-full min-h-screen overflow-y-auto pb-4">
      <div className="p-8 pb-4 sticky top-0 max-w-3xl mx-auto bg-white">
        <div className="flex gap-3 items-center -ml-2">
          <button
            aria-label="Kembali"
            className="rounded-full leading-0 flex items-center justify-center w-8 h-8 cursor-pointer"
            onClick={() => history.back()}
          >
            <CaretLeftIcon weight="bold" className="w-6 h-6" />
          </button>
          <h1 className="font-bold text-2xl">Stasiun Disimpan</h1>
        </div>
        <h2 className="mt-4 text-sm">Perubahan pada stasiun di bawah ini akan disimpan pada saat meninggalkan halaman ini</h2>
      </div>
      {!isReady
        ? (
            <div className="flex items-center justify-center mt-4 p-8 max-w-3xl mx-auto">
              <div className="rounded-full border-4 border-slate-600 border-t-transparent w-12 h-12 m-auto animate-spin" aria-label="Memuat data..." />
            </div>
          )
        : (
            <ul className="max-w-3xl mx-auto">
              {stations.length > 0
                ? (
                    stations.map((station, index) => (
                      <SavedStationItem
                        stationId={station.id}
                        key={station.id}
                        onSaveButtonClick={handleSaveStationButton}
                        isSaved={station.isSaved}
                        isFirst={index === 0}
                        isLast={index === stations.length - 1}
                        onMove={handleMove}
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
