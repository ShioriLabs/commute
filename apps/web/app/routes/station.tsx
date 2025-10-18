import type { Station } from 'models/stations'
import type { StandardResponse } from '@schema/response'
import type { Route } from './+types/station'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useNavigationType } from 'react-router'
import { BookmarkIcon, BookmarkSlashIcon, XMarkIcon } from '@heroicons/react/24/outline'
import type { LineGroupedTimetable } from 'models/schedules'
import LineCard from '~/components/line-card'
import { fetcher } from 'utils/fetcher'
import useSWR from 'swr'
import { AMENITY_TYPES } from '@commute/constants'

const swrConfig = {
  dedupingInterval: import.meta.env.DEV ? 0 : 60 * 60 * 1000,
  focusThrottleInterval: import.meta.env.DEV ? 0 : 60 * 60 * 1000,
  revalidateOnFocus: true,
  shouldRetryOnError: false
}

export function meta() {
  return [
    { title: 'Memuat... - Commute' },
    { name: 'theme-color', content: '#FFFFFF' }
  ]
}

function EmptyState({ mode = 'NO_DATA' }: { mode: 'OFFLINE' | 'NO_DATA' }) {
  const title = mode === 'OFFLINE' ? 'Jaringan Tidak Tersedia' : 'Jadwal Tidak Tersedia'
  const message = mode === 'OFFLINE'
    ? 'Silakan coba lagi beberapa saat lagi saat jaringan Anda tersambung'
    : 'Silakan coba lagi beberapa saat lagi'

  return (
    <div className="w-full h-auto flex items-center justify-center mt-8 flex-col max-w-3xl mx-auto">
      <picture>
        <source src="/img/search_empty.webp" type="image/webp" />
        <img src="/img/search_empty.png" alt="Gambar peron stasiun dengan jembatan di atasnya, dengan kaca pembesar bergambar tanda tanya di depannya" className="w-48 h-48 aspect-square object-contain" />
      </picture>
      <span className="text-2xl text-center font-bold mt-0">{title}</span>
      <p className="text-center mt-2">
        {message}
      </p>
    </div>
  )
}

export default function StationPage({ params }: Route.ComponentProps) {
  const stationUrl = useMemo(() =>
    new URL(`/stations/${params.operator}/${params.code}`, import.meta.env.VITE_API_BASE_URL).href,
  [params.operator, params.code]
  )
  const timetableUrl = useMemo(() =>
    new URL(`/stations/${params.operator}/${params.code}/timetable/grouped?compact=1`, import.meta.env.VITE_API_BASE_URL).href,
  [params.operator, params.code]
  )

  const station = useSWR<StandardResponse<Station>>(stationUrl, fetcher, swrConfig)
  const timetable = useSWR<StandardResponse<LineGroupedTimetable>>(timetableUrl, fetcher, swrConfig)
  const navigationType = useNavigationType()
  const navigate = useNavigate()
  const [saved, setSaved] = useState(false)
  const [isOnline, setIsOnline] = useState(navigator.onLine)

  useEffect(() => {
    function handleOnline() {
      setIsOnline(true)
    }

    function handleOffline() {
      setIsOnline(false)
    }

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  useEffect(() => {
    if (station.isLoading) return
    const savedStationsRaw = localStorage.getItem('saved-stations')
    if (!savedStationsRaw || !station.data?.data?.id) {
      setSaved(false)
      return
    }

    const savedStations = JSON.parse(savedStationsRaw) as string[]
    setSaved(savedStations.includes(station.data.data.id))

    // Set page title
    document.title = `${station.data.data.formattedName} - Commute`
  }, [station.data, station.isLoading])

  const handleBackButton = useCallback(() => {
    if (navigationType === 'POP') {
      navigate('/')
    } else {
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
    } else {
      localStorage.setItem('saved-stations', JSON.stringify([...savedStations, station.data.data.id]))
      setSaved(true)
    }
  }, [station.data])

  return (
    <div className="bg-white w-full min-h-screen">
      <div className="w-full bg-white/40 backdrop-blur sticky top-0 h-48 mask-b-to-100% frosted-glass-mask pointer-events-none z-10">
        <div className="p-8 max-w-3xl mx-auto pointer-events-auto">
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
      {timetable.isLoading && (
        <div className="-mt-20 px-4 pb-8 flex flex-col gap-2 max-w-3xl mx-auto">
          <div className="animate-pulse w-full h-72 bg-slate-200 rounded-lg" />
        </div>
      )}

      {!timetable.isLoading && (() => {
        if (!isOnline) return <EmptyState mode="OFFLINE" />
        if (timetable.error || !timetable.data?.data?.length) return <EmptyState mode="NO_DATA" />

        return (
          <>
            <ul className="-mt-20 px-4 pb-8 flex flex-col gap-2 max-w-3xl mx-auto">
              {timetable.data.data.map(line => (
                <LineCard key={line.lineCode} line={line} />
              ))}
            </ul>
            <section className="px-4 pb-8 max-w-3xl mx-auto">
              <h2 className="font-semibold text-xl px-4">Fasilitas</h2>
              {station.data?.data?.amenities.length
                ? (
                    <ul className="flex flex-col gap-2 mt-4">
                      {station.data.data.amenities.map(amenity => (
                        <li key={amenity.type} className="flex items-center px-4 py-2 gap-2">
                          <span className="font-bold gap-2">
                            {AMENITY_TYPES[amenity.type]}
                          </span>
                          <span className="ml-auto text-gray-600">{amenity.text || 'Tersedia'}</span>
                        </li>
                      ))}
                    </ul>
                  )
                : (
                    <p className="mt-4 px-4 text-gray-600">Tidak ada data fasilitas untuk stasiun ini</p>
                  )}
            </section>
          </>
        )
      })()}
    </div>
  )
}
