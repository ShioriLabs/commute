import { useEffect, useState } from 'react'
import type { Route } from './+types/home'
import { Link } from 'react-router'
import type { Station } from '@schema/stations';
import type { LineGroupedTimetable } from 'models/schedules';
import type { StandardResponse } from '@schema/response';
import LineCard from '~/components/line-card';
import { MagnifyingGlassIcon } from '@heroicons/react/20/solid';
import useSWR from 'swr';
import { fetcher } from 'utils/fetcher';

export function meta({}: Route.MetaArgs) {
  return [
    { title: 'Commute' }
  ];
}

function StationCard({ stationId }: { stationId: string }) {
  const [operator, code] = stationId.split(/\-/g)
  const station = useSWR<StandardResponse<Station>>(new URL(`/${operator}/stations/${code}`, import.meta.env.VITE_API_BASE_URL).href, fetcher)
  const timetable = useSWR<StandardResponse<LineGroupedTimetable>>(new URL(`/${operator}/stations/${code}/timetable/grouped`, import.meta.env.VITE_API_BASE_URL).href, fetcher)

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
        <h1 className="font-bold text-2xl">Stasiun { station.data.data.formattedName }</h1>
        <ul className="mt-4 flex flex-col gap-4">
          {timetable?.data?.data?.map(line => (
            <LineCard key={line.lineCode} line={line} />
          ))}
        </ul>
      </article>
    </li>
  )
}

export default function Home() {
  const [stations, setStations] = useState<string[]>([]);
  const [isReady, setIsReady] = useState(false);

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
      {isReady ? (
        <>
          {stations.length > 0 ? (
            <ul className="px-4 pt-8 flex flex-col gap-8 pb-36">
              {stations.map(station => (
                <StationCard key={station} stationId={station} />
              ))}
            </ul>
          ) : (
            <div className="w-screen h-screen flex items-center justify-center flex-col p-2">
              <span className="text-2xl text-center font-bold">Belum Ada Stasiun Disimpan</span>
              <p className="text-center mt-2">Klik tombol <b>Cari Stasiun</b> di bawah untuk mulai cari jadwal & simpan stasiun!</p>
            </div>
          )}
        </>
      ) : (
        <div className="w-screen h-screen flex items-center justify-center flex-col p-2">
          <div className="rounded-full border-4 border-slate-600 border-t-transparent w-12 h-12 m-auto animate-spin" aria-label="Loading data..." />
        </div>
      )}
      <nav className="fixed bottom-0 py-4 flex gap-4 bg-gradient-to-t from-10% from-black/20 w-screen">
        <Link to="/search" className="ml-4 bg-white p-4 rounded-xl shadow w-screen h-screen max-w-40 max-h-28 border-2 border-gray-200 flex flex-col relative overflow-clip">
          <div className="absolute -bottom-4 -right-4 rounded-full bg-slate-100 p-4 z-[1]">
            <MagnifyingGlassIcon className="w-12 h-12" />
          </div>
          <b className="z-[2]">Cari</b>
          <span className="text-xl z-[2]">Stasiun</span>
        </Link>
      </nav>
    </main>
  );
}
