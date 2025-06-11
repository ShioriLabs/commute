import { useEffect, useState } from 'react'
import type { Station } from 'models/stations'
import type { LineGroupedTimetable } from 'models/schedules'
import type { StandardResponse } from '@schema/response'
import LineCard from '~/components/line-card'
import useSWR from 'swr'
import { fetcher } from 'utils/fetcher'
import SearchStationsButton from '~/components/nav-buttons/search-stations'
import { ChevronRightIcon } from '@heroicons/react/20/solid'
import { Link } from 'react-router'

export function meta() {
  return [
    { title: 'Commute' },
    { name: 'theme-color', content: '#FFF8F8' }
  ]
}

function StationCard({ stationId }: { stationId: string }) {
  const [operator, code] = stationId.split(/-/g)
  const station = useSWR<StandardResponse<Station>>(new URL(`/stations/${operator}/${code}`, import.meta.env.VITE_API_BASE_URL).href, fetcher)
  const timetable = useSWR<StandardResponse<LineGroupedTimetable>>(new URL(`/stations/${operator}/${code}/timetable/grouped`, import.meta.env.VITE_API_BASE_URL).href, fetcher)

  if (station.isLoading) {
    return (
      <li className="animate-pulse">
        <article>
          <div className="h-6 w-64 bg-slate-200 rounded" />
          <div className="mt-4 w-full h-[320px] bg-slate-200 rounded-xl" />
        </article>
      </li>
    )
  }

  if (station.error || station.data === undefined || station.data.data === undefined) {
    return null
  }

  return (
    <li>
      <article>
        <h1 className="font-bold text-2xl flex">
          <Link to={`/station/${station.data.data.operator.code}/${station.data.data.code}`} className="group flex-grow">
            Stasiun&nbsp;
            { station.data.data.formattedName }
            <ChevronRightIcon className="inline w-6 h-6 group-hover:ml-1 ml-0 transition-[margin] duration-200" />
          </Link>
        </h1>
        { timetable.isLoading
          ? (
              <div className="mt-4 w-full h-[320px] bg-slate-200 rounded-xl" />
            )
          : (
              <ul className="mt-4 flex flex-col lg:grid lg:grid-cols-2 gap-4">
                {timetable?.data?.data?.map(line => (
                  <LineCard key={line.lineCode} line={line} />
                ))}
              </ul>
            )}
      </article>
    </li>
  )
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
                    <ul className="px-4 pt-8 flex flex-col gap-8 pb-36 max-w-3xl mx-auto" aria-label="Daftar stasiun tersimpan">
                      {stations.map(station => (
                        <StationCard key={station} stationId={station} />
                      ))}
                    </ul>
                  )
                : (
                    <div className="w-screen h-screen flex items-center justify-center flex-col p-2" aria-live="polite">
                      <span className="text-2xl text-center font-bold">Belum Ada Stasiun Disimpan</span>
                      <p className="text-center mt-2">
                        Klik tombol
                        <b>Cari Stasiun</b>
                        {' '}
                        di bawah untuk mulai cari jadwal & simpan stasiun!
                      </p>
                    </div>
                  )}
            </>
          )
        : (
            <div className="w-screen h-screen flex items-center justify-center flex-col p-2" aria-live="assertive">
              <div className="rounded-full border-4 border-slate-600 border-t-transparent w-12 h-12 m-auto animate-spin" aria-label="Memuat data..." />
            </div>
          )}
      <nav className="fixed bottom-0 py-4 bg-gradient-to-t from-10% from-black/20 w-screen" aria-label="Navigasi utama">
        <div className="w-full max-w-3xl mx-auto flex gap-4">
          <SearchStationsButton className="ml-4" />
        </div>
      </nav>
    </main>
  )
}
