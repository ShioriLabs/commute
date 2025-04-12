import { useCallback, useEffect, useState } from 'react'
import type { Route } from './+types/home'
import { Link } from 'react-router'
import type { Station } from '@schema/stations';
import type { LineGroupedTimetable } from 'models/schedules';
import type { StandardResponse } from '@schema/response';
import LineCard from '~/components/line-card';

export function meta({}: Route.MetaArgs) {
  return [
    { title: 'Commute' }
  ];
}

function StationCard({ stationId }: { stationId: string }) {
  const [stationData, setStationData] = useState<Station>()
  const [timetable, setTimetable] = useState<LineGroupedTimetable>()

  const fetchData = useCallback(async (stationId: string) => {
    const [operator, code] = stationId.split(/\-/g)
    const [station, timetable] = await Promise.all([
        fetch(new URL(`/${operator}/stations/${code}`, import.meta.env.VITE_API_BASE_URL)),
        fetch(new URL(`/${operator}/stations/${code}/timetable/grouped`, import.meta.env.VITE_API_BASE_URL))
      ])

      if (station.ok && timetable.ok) {
        const stationJson: StandardResponse<Station> = await station.json()
        const timetableJson: StandardResponse<LineGroupedTimetable> = await timetable.json()

        setStationData(stationJson.data)
        setTimetable(timetableJson.data)
      }
  }, [setStationData, setTimetable])

  useEffect(() => {
    fetchData(stationId)
  }, [stationId])

  return (
    <li>
      <article>
        <h1 className="font-bold text-2xl">Stasiun { stationData?.formattedName }</h1>
        <ul className="mt-4 flex flex-col gap-2">
          {timetable?.map(line => (
            <LineCard key={line.lineCode} line={line} />
          ))}
        </ul>
      </article>
    </li>
  )
}

export default function Home() {
  const [stations, setStations] = useState<string[]>([]);

  useEffect(() => {
    const savedStationsRaw = localStorage.getItem('saved-stations')
    if (!savedStationsRaw) {
      localStorage.setItem('saved-stations', '[]')
      return
    }

    try {
      const parsedSavedStations = JSON.parse(savedStationsRaw)
      if (!(parsedSavedStations instanceof Array)) {
        localStorage.setItem('saved-stations', '[]')
        return
      }

      setStations(parsedSavedStations as string[])
    } catch (e) {
      if (e instanceof SyntaxError) {
        localStorage.setItem('saved-stations', '[]')
      }
    }

  }, [])

  return (
    <main className="bg-gray-100 w-screen min-h-screen">
      <ul className="mt-8 p-4 flex flex-col gap-8 pb-28">
        {stations.map(station => (
          <StationCard key={station} stationId={station} />
        ))}
      </ul>
      <nav className="fixed bottom-0 py-4 flex gap-4">
        <Link to="/search" className="ml-4 bg-white block p-4 rounded-xl shadow w-screen h-screen max-w-40 max-h-28 border-2 border-gray-200">
          <b>Cari</b>
        </Link>
      </nav>
      <div className="p-4">
      </div>
    </main>
  );
}
