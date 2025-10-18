import { useEffect, useState } from 'react'
import type { Station } from 'models/stations'
import type { CompactLineGroupedTimetable } from 'models/schedules'
import type { StandardResponse } from '@schema/response'
import LineCard from '~/components/line-card'
import useSWR from 'swr'
import { fetcher } from 'utils/fetcher'
import SearchStationsButton from '~/components/nav-buttons/search-stations'
import { ChevronRightIcon } from '@heroicons/react/20/solid'
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
    { name: 'theme-color', content: '#FFF8F8' },
    { name: 'description', content: 'Aplikasi Jadwal Kereta Buat Anak Jakarta' },
    { name: 'keywords', content: 'commute, jadwal kereta, kereta api, krl, jakarta, indonesia, lrt, mrt, commuter line, lrt jabodebek, mrt jakarta, lrt jakarta' },
    { property: 'og:title', content: 'Commute' },
    { property: 'og:description', content: 'Aplikasi Jadwal Kereta Buat Anak Jakarta' },
    { property: 'og:image', content: 'https://commute.shiorilabs.id/img/og-image.png' },
    { name: 'twitter:title', content: 'Commute' },
    { name: 'twitter:description', content: 'Aplikasi Jadwal Kereta Buat Anak Jakarta' },
    { name: 'twitter:image', content: 'https://commute.shiorilabs.id/img/og-image.png' }
  ]
}

function StationCard({ stationId }: { stationId: string }) {
  const [operator, code] = stationId.split(/-/g)
  const station = useSWR<StandardResponse<Station>>(new URL(`/stations/${operator}/${code}`, import.meta.env.VITE_API_BASE_URL).href, fetcher, swrConfig)
  const timetable = useSWR<StandardResponse<CompactLineGroupedTimetable>>(new URL(`/stations/${operator}/${code}/timetable/grouped?compact=1`, import.meta.env.VITE_API_BASE_URL).href, fetcher, swrConfig)

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

  if (station.error || station.data === undefined || station.data.data === undefined) {
    return null
  }

  return (
    <li>
      <article>
        <h1 className="font-bold text-2xl flex px-8 py-6 sticky top-0 bg-rose-50/20 backdrop-blur-2xl z-10 lg:relative lg:backdrop-blur-none lg:bg-transparent">
          <Link to={`/station/${station.data.data.operator.code}/${station.data.data.code}`} className="group flex-grow">
            Stasiun&nbsp;
            { station.data.data.formattedName }
            <ChevronRightIcon className="inline w-6 h-6 group-hover:ml-1 ml-0 transition-[margin] duration-200" />
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
                    <div className="w-screen h-screen flex items-center justify-center flex-col p-2" aria-live="polite">
                      <picture>
                        <source srcSet="/img/station.webp" type="image/webp" />
                        <img src="/img/station.png" alt="Gambar peron stasiun dengan jembatan di atasnya" className="w-48 h-48 aspect-square object-contain" fetchPriority="high" />
                      </picture>
                      <span className="text-2xl text-center font-bold mt-0">Belum Ada Stasiun Disimpan</span>
                      <p className="text-center mt-2">
                        Klik tombol
                        {' '}
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
      <nav className="fixed bottom-0 py-4 bg-gradient-to-t from-30% from-rose-50/40 w-screen z-20" aria-label="Navigasi utama">
        <div className="w-full max-w-3xl mx-auto flex gap-4">
          <SearchStationsButton className="ml-4 lg:ml-2" />
          <SettingsButton className="mr-4 lg:mr-2" />
        </div>
      </nav>
    </main>
  )
}
