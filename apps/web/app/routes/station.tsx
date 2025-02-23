import type { Station } from '@schema/stations'
import type { Schedule } from '@schema/schedules'
import type { StandardResponse } from '@schema/response'
import type { Route } from './+types/station'
import { useMemo, useState } from 'react'

export async function clientLoader({ params }: Route.ClientLoaderArgs) {
  const [station, timetable] = await Promise.all([
    fetch(new URL(`/${params.operator}/stations/${params.code}`, import.meta.env.VITE_API_BASE_URL)),
    fetch(new URL(`/${params.operator}/stations/${params.code}/timetable`, import.meta.env.VITE_API_BASE_URL))
  ])

  if (station.ok && timetable.ok) {
    const stationJson: StandardResponse<Station> = await station.json()
    const timetableJson: StandardResponse<Schedule[]> = await timetable.json()

    return {
      status: station.status,
      data: {
        ...stationJson.data,
        timetable: timetableJson.data ?? []
      }
    }
  }

  return {
    status: 500
  }
}

export default function Search({ loaderData }: Route.ComponentProps) {
  return (
    <div>
      <div className="p-8 pb-4 sticky top-0 bg-white">
        <div className="flex gap-4 items-center justify-between">
          <div className="flex flex-col">
            <h1 className="font-bold text-2xl">{ loaderData.data?.formattedName }</h1>
            <span className="font-semibold">{ loaderData.data?.operator }</span>
          </div>
          <button onClick={() => history.back()} aria-label="Close search page" className="rounded-full leading-0 flex items-center justify-center text-2xl font-bold w-10 h-10">
            &#x2715;
          </button>
        </div>
      </div>
      <ul className="mt-4">
        {loaderData.data?.timetable.map(item => (
          <li key={item.id} className="px-8 py-4 flex flex-col">
            <span className="font-bold text-lg">Arah menuju {item.boundFor}</span>
            <span className="font-semibold">{item.estimatedDeparture.toString()}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
