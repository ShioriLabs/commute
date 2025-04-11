import type { Station } from '@schema/stations'
import type { StandardResponse } from '@schema/response'
import type { Route } from './+types/station'
import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useNavigationType } from 'react-router'
import { BookmarkIcon, BookmarkSlashIcon, XMarkIcon } from '@heroicons/react/24/outline'
import type { LineGroupedTimetable, Schedule } from 'models/schedules'

export async function clientLoader({ params }: Route.ClientLoaderArgs) {
  const [station, timetable] = await Promise.all([
    fetch(new URL(`/${params.operator}/stations/${params.code}`, import.meta.env.VITE_API_BASE_URL)),
    fetch(new URL(`/${params.operator}/stations/${params.code}/timetable/grouped`, import.meta.env.VITE_API_BASE_URL))
  ])

  if (station.ok && timetable.ok) {
    const stationJson: StandardResponse<Station> = await station.json()
    const timetableJson: StandardResponse<LineGroupedTimetable> = await timetable.json()

    return {
      status: station.status,
      data: {
        ...stationJson.data,
        lines: timetableJson.data ?? []
      }
    }
  }

  return {
    status: 500
  }
}

function getNextSchedules(schedules: Schedule[], limit = 3) {
  const now = new Date()
  const returning: Schedule[] = []
  for (const schedule of schedules) {
    if (returning.length === limit) break
    const parsedDeparture = new Date(schedule.estimatedDeparture)
    if (parsedDeparture < now) continue
    returning.push(schedule)
  }

  return returning
}

function parseTime(timeString: string) {
  return new Date(`${new Date().toDateString()} ${timeString}`)
}

export default function Search({ loaderData }: Route.ComponentProps) {
  const navigationType = useNavigationType()
  const navigate = useNavigate()
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    const savedStationsRaw = localStorage.getItem('saved-stations')
    if (!savedStationsRaw || !loaderData?.data?.id) {
      setSaved(false)
      return
    }

    const savedStations = JSON.parse(savedStationsRaw) as string[]
    setSaved(savedStations.includes(loaderData.data.id))
  }, [])

  const handleBackButton = useCallback(() => {
    if (navigationType === 'POP') {
      navigate("/")
    } else {
      history.back()
    }
  }, [navigationType])

  const handleSaveStationButton = useCallback(() => {
    if (!loaderData.data?.id) return
    const savedStations = JSON.parse(localStorage.getItem('saved-stations') ?? "[]") as string[]

    if (!savedStations) {
      localStorage.setItem('saved-stations', JSON.stringify([loaderData.data.id]))
      setSaved(true)
      return
    }

    if (savedStations.includes(loaderData.data.id)) {
      const newSavedStations = savedStations.filter(item => item !== loaderData.data.id)
      localStorage.setItem('saved-stations', JSON.stringify(newSavedStations))
      setSaved(false)
    } else {
      localStorage.setItem('saved-stations', JSON.stringify([...savedStations, loaderData.data.id]))
      setSaved(true)
    }

  }, [])

  return (
    <div>
      <div className="p-8 pb-4 sticky top-0 bg-white">
        <div className="flex gap-4 items-center justify-between">
          <div className="flex flex-col">
            <h1 className="font-bold text-2xl">{ loaderData.data?.formattedName }</h1>
            <span className="font-semibold">{ loaderData.data?.operator }</span>
          </div>
          <div className="flex gap-4">
            <button onClick={handleSaveStationButton} aria-label="Save this station" className="rounded-full leading-0 flex items-center justify-cente font-bold w-8 h-8">
              {saved ? (
                <BookmarkSlashIcon />
              ) : (
                <BookmarkIcon />
              )}
            </button>
            <button onClick={handleBackButton} aria-label="Close search page" className="rounded-full leading-0 flex items-center justify-cente font-bold w-8 h-8">
              <XMarkIcon />
            </button>
          </div>
        </div>
      </div>
      <ul className="mt-4 px-4 pb-8 flex flex-col gap-2">
        {loaderData.data?.lines.map(line => (
          <li key={line.lineCode} className="rounded-lg w-full min-h-8 shadow-lg border-t-[16px] border-gray-100" style={{ borderTopColor: line.colorCode }}>
            <article className="p-4">
              <h1 className="font-bold text-xl">{line.name}</h1>
            </article>
            <ul className="border-t border-t-gray-300">
              {line.timetable.map(direction => {
                const nextSchedules = getNextSchedules(direction.schedules)

                return (
                  <li key={direction.boundFor} className="p-4 flex items-start justify-between gap-2">
                    <div>
                      <span className="font-bold">{direction.boundFor}</span>
                    </div>
                    <div className="text-right flex flex-col">
                      <span className="font-bold">{parseTime(nextSchedules[0].estimatedDeparture).toLocaleTimeString('id-ID', { timeStyle: 'short' })}</span>
                      {nextSchedules.length > 1 ? (
                        <span className="font-bold text-sm text-gray-500">lalu {nextSchedules.slice(1, 3).map(sched => parseTime(sched.estimatedDeparture).toLocaleTimeString('id-ID', { timeStyle: 'short' })).join(', ')}</span>
                      ) : null}
                    </div>
                  </li>
                )
              })}
            </ul>
          </li>
        ))}
      </ul>
    </div>
  )
}
