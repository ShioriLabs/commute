import type { Station } from 'models/stations'
import type { StandardResponse } from '@schema/response'
import type { Route } from './+types/station'
import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useNavigationType } from 'react-router'
import { BookmarkIcon, BookmarkSlashIcon, XMarkIcon } from '@heroicons/react/24/outline'
import type { LineGroupedTimetable } from 'models/schedules'
import LineCard from '~/components/line-card'
import { fetcher } from 'utils/fetcher'
import useSWR from 'swr'

export default function StationPage({ params }: Route.ComponentProps) {
  const station = useSWR<StandardResponse<Station>>(new URL(`/${params.operator}/stations/${params.code}`, import.meta.env.VITE_API_BASE_URL).href, fetcher)
  const timetable = useSWR<StandardResponse<LineGroupedTimetable>>(new URL(`/${params.operator}/stations/${params.code}/timetable/grouped`, import.meta.env.VITE_API_BASE_URL).href, fetcher)
  const navigationType = useNavigationType()
  const navigate = useNavigate()
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (station.isLoading) return
    const savedStationsRaw = localStorage.getItem('saved-stations')
    if (!savedStationsRaw || !station.data?.data?.id) {
      setSaved(false)
      return
    }

    const savedStations = JSON.parse(savedStationsRaw) as string[]
    setSaved(savedStations.includes(station.data.data.id))
  }, [station.data, station.isLoading])

  const handleBackButton = useCallback(() => {
    if (navigationType === 'POP') {
      navigate('/')
    }
    else {
      history.back()
    }
  }, [navigationType])

  const handleSaveStationButton = useCallback(() => {
    if (!station.data?.data?.id) return
    const savedStations = JSON.parse(localStorage.getItem('saved-stations') ?? '[]') as string[]

    if (!savedStations) {
      localStorage.setItem('saved-stations', JSON.stringify([station.data.data.id]))
      setSaved(true)
      return
    }

    if (savedStations.includes(station.data.data.id)) {
      const newSavedStations = savedStations.filter(item => item !== (station.data?.data?.id ?? ''))
      localStorage.setItem('saved-stations', JSON.stringify(newSavedStations))
      setSaved(false)
    }
    else {
      localStorage.setItem('saved-stations', JSON.stringify([...savedStations, station.data.data.id]))
      setSaved(true)
    }
  }, [])

  return (
    <div className="bg-white w-full min-h-screen">
      <div className="w-full bg-white/30 backdrop-blur-lg sticky top-0">
        <div className="p-8 max-w-3xl mx-auto">
          <div className="flex gap-4 items-center justify-between">
            <div className="flex flex-col">
              {station.isLoading
                ? (
                    <div className="animate-pulse w-64 h-6 bg-slate-200 rounded-lg" />
                  )
                : (
                    <h1 className="font-bold text-2xl">{ station.data?.data?.formattedName }</h1>
                  )}
            </div>
            <div className="flex gap-4">
              {station.isLoading
                ? (
                    <div className="animate-pulse w-8 h-8 bg-slate-200 rounded-full" />
                  )
                : (
                    <button
                      onClick={handleSaveStationButton}
                      aria-label={saved ? 'Hapus stasiun ini dari favorit' : 'Simpan stasiun ini ke favorit'}
                      className="rounded-full leading-0 flex items-center justify-center font-bold w-8 h-8 cursor-pointer"
                    >
                      {saved
                        ? (
                            <BookmarkSlashIcon />
                          )
                        : (
                            <BookmarkIcon />
                          )}
                    </button>
                  )}
              <button
                onClick={handleBackButton}
                aria-label="Tutup halaman stasiun"
                className="rounded-full leading-0 flex items-center justify-center font-bold w-8 h-8 cursor-pointer"
              >
                <XMarkIcon />
              </button>
            </div>
          </div>
        </div>
      </div>
      {timetable.isLoading
        ? (
            <div className="mt-4 px-4 pb-8 flex flex-col gap-2 max-w-3xl mx-auto">
              <div className="animate-pulse w-full h-72 bg-slate-200 rounded-lg" />
              <div className="animate-pulse w-full h-64 bg-slate-200 rounded-lg" />
              <div className="animate-pulse w-full h-96 bg-slate-200 rounded-lg" />
            </div>
          )
        : (
            <ul className="mt-4 px-4 pb-8 flex flex-col gap-2 max-w-3xl mx-auto">
              {timetable.data?.data?.map(line => (
                <LineCard key={line.lineCode} line={line} />
              ))}
            </ul>
          )}
    </div>
  )
}
