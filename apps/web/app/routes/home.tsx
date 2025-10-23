import { useEffect, useState } from 'react'
import type { Station } from 'models/stations'
import type { CompactLineGroupedTimetable } from 'models/schedules'
import type { StandardResponse } from '@schema/response'
import LineCard from '~/components/line-card'
import useSWR from 'swr'
import { fetcher } from 'utils/fetcher'
import SearchStationsButton from '~/components/nav-buttons/search-stations'
import { CaretRightIcon } from '@phosphor-icons/react'
import { Link } from 'react-router'
import SettingsButton from '~/components/nav-buttons/settings'

const swrConfig = {
  dedupingInterval: import.meta.env.DEV ? 0 : 60 * 60 * 1000,
  focusThrottleInterval: import.meta.env.DEV ? 0 : 60 * 60 * 1000,
  revalidateOnFocus: true,
  shouldRetryOnError: false
}

export function meta() {
  return [
    { title: 'Commute' },
    { name: 'theme-color', content: '#FFF8F8' }
  ]
}

function EmptyState({ mode = 'NO_SAVED' }: { mode: 'NO_SAVED' | 'OFFLINE' }) {
  return (
    <div className="w-screen h-screen flex items-center justify-center flex-col p-2" aria-live="polite">
      <picture>
        <source srcSet="/img/station.webp" type="image/webp" />
        <img src="/img/station.png" alt="Gambar peron stasiun dengan jembatan di atasnya" className="w-48 h-48 aspect-square object-contain" fetchPriority="high" />
      </picture>
      {mode === 'NO_SAVED' && (
        <>
          <span className="text-2xl text-center font-bold mt-0">Belum Ada Stasiun Disimpan</span>
          <p className="text-center mt-2">
            Klik tombol
            {' '}
            <b>Cari Stasiun</b>
            {' '}
            di bawah untuk mulai cari jadwal & simpan stasiun!
          </p>
        </>
      )}

      {mode === 'OFFLINE' && (
        <>
          <span className="text-2xl text-center font-bold mt-0">Jaringan Tidak Tersedia</span>
          <p className="text-center mt-2">
            Silakan coba lagi beberapa saat lagi saat jaringan Anda tersambung
          </p>
        </>
      )}
    </div>
  )
}

function StationCard({ stationId }: { stationId: string }) {
  const [operator, code] = stationId.split(/-/g)
  const station = useSWR<StandardResponse<Station>>(new URL(`/stations/${operator}/${code}`, import.meta.env.VITE_API_BASE_URL).href, fetcher, swrConfig)
  const timetable = useSWR<StandardResponse<CompactLineGroupedTimetable>>(new URL(`/stations/${operator}/${code}/timetable/grouped?compact=1`, import.meta.env.VITE_API_BASE_URL).href, fetcher, swrConfig)
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

  if (station.isLoading && !station.error) {
    return (
      <li className="animate-pulse px-4">
        <article>
          <div className="h-6 w-64 mt-4 mx-4 bg-slate-200 rounded" />
          <div className="mt-4 w-full h-[320px] bg-slate-200 rounded-xl" />
        </article>
      </li>
    )
  }

  if (station.data?.data) {
    return (
      <li>
        <article>
          <h1 className="font-bold text-2xl flex px-8 py-6 sticky top-0 bg-rose-50/20 backdrop-blur-2xl z-10 lg:relative lg:backdrop-blur-none lg:bg-transparent">
            <Link to={`/station/${station.data.data.operator.code}/${station.data.data.code}`} className="group flex-grow">
              Stasiun&nbsp;
              { station.data.data.formattedName }
              <CaretRightIcon weight="bold" className="inline w-4 h-4 group-hover:ml-3 ml-2 transition-[margin] duration-200" />
            </Link>
          </h1>
          { timetable.isLoading
            ? (
                <div className="flex h-[320px] bg-slate-200 rounded-xl mx-4" />
              )
            : (
                <ul className="flex flex-col lg:grid lg:grid-cols-2 gap-4 mx-4">
                  {timetable?.data?.data?.map(line => (
                    <LineCard key={line.lineCode} line={line} />
                  ))}
                </ul>
              )}
        </article>
      </li>
    )
  }

  if (!isOnline) {
    return <EmptyState mode="OFFLINE" />
  }

  return <EmptyState mode="NO_SAVED" />
}

export default function HomePage() {
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
    <main className="w-full min-h-screen">
      {isReady
        ? (
            <>
              {stations.length > 0
                ? (
                    <ul className="flex flex-col gap-8 pb-42 max-w-3xl mx-auto" aria-label="Daftar stasiun tersimpan">
                      {stations.map(station => (
                        <StationCard key={station} stationId={station} />
                      ))}
                    </ul>
                  )
                : (
                    <EmptyState mode="NO_SAVED" />
                  )}
            </>
          )
        : (
            <div className="w-screen h-screen flex items-center justify-center flex-col p-2" aria-live="assertive">
              <div className="rounded-full border-4 border-slate-600 border-t-transparent w-12 h-12 m-auto animate-spin" aria-label="Memuat data..." />
            </div>
          )}
      <nav className="fixed bottom-0 py-4 bg-gradient-to-t from-30% from-rose-50/40 w-screen z-20" aria-label="Navigasi utama">
        <div className="w-full max-w-3xl mx-auto flex gap-4">
          <SearchStationsButton className="ml-4 lg:ml-2" />
          <SettingsButton className="mr-4 lg:mr-2" />
        </div>
      </nav>
    </main>
  )
}
