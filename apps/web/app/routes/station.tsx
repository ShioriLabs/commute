import type { Station } from '@schema/stations'
import type { ScheduleWithLineInfo } from '@schema/schedules'
import type { StandardResponse } from '@schema/response'
import type { Route } from './+types/station'
import { useCallback, useMemo, useState } from 'react'
import { useNavigate, useNavigationType } from 'react-router'

export async function clientLoader({ params }: Route.ClientLoaderArgs) {
  const [station, timetable] = await Promise.all([
    fetch(new URL(`/${params.operator}/stations/${params.code}`, import.meta.env.VITE_API_BASE_URL)),
    fetch(new URL(`/${params.operator}/stations/${params.code}/timetable`, import.meta.env.VITE_API_BASE_URL))
  ])

  if (station.ok && timetable.ok) {
    const stationJson: StandardResponse<Station> = await station.json()
    const timetableJson: StandardResponse<ScheduleWithLineInfo[]> = await timetable.json()

    const lines: Record<
      string,
      { name: string
        lineCode: string
        colorCode: `#${string}`,
        timetable: ScheduleWithLineInfo[]
      }
    > = { }

    const now = new Date()
    if (timetableJson.data) {
      for (const schedule of timetableJson.data) {
        const estimatedDeparture = new Date(`${now.toDateString()} ${schedule.estimatedDeparture}`)
        if (estimatedDeparture < now) continue
        if (schedule.lineCode === 'NUL') continue

        if (lines[schedule.lineCode]) {
          lines[schedule.lineCode].timetable.push({...schedule, estimatedDeparture} )
          continue
        }

        lines[schedule.lineCode] = {
          ...schedule.line,
          timetable: [{...schedule, estimatedDeparture}]
        }
      }
    }

    const linesWithGroupedTimetable = Object.values(lines).map(line => {
      const groupedTimetable: Record<string, ScheduleWithLineInfo[]> = {}
      for (const schedule of line.timetable) {
        if (groupedTimetable[schedule.boundFor]) {
          groupedTimetable[schedule.boundFor].push(schedule)
          continue
        }

        groupedTimetable[schedule.boundFor] = [schedule]
      }

      return {
        ...line,
        timetable: Object.values(groupedTimetable)
      }
    })

    return {
      status: station.status,
      data: {
        ...stationJson.data,
        lines: linesWithGroupedTimetable
      }
    }
  }

  return {
    status: 500
  }
}

export default function Search({ loaderData }: Route.ComponentProps) {
  const navigationType = useNavigationType()
  const navigate = useNavigate()

  const handleBackButton = useCallback(() => {
    if (navigationType === 'POP') {
      navigate("/")
    } else {
      history.back()
    }
  }, [navigationType])

  return (
    <div>
      <div className="p-8 pb-4 sticky top-0 bg-white">
        <div className="flex gap-4 items-center justify-between">
          <div className="flex flex-col">
            <h1 className="font-bold text-2xl">{ loaderData.data?.formattedName }</h1>
            <span className="font-semibold">{ loaderData.data?.operator }</span>
          </div>
          <button onClick={handleBackButton} aria-label="Close search page" className="rounded-full leading-0 flex items-center justify-center text-2xl font-bold w-10 h-10">
            &#x2715;
          </button>
        </div>
      </div>
      <ul className="mt-4 px-4 pb-8 flex flex-col gap-2">
        {loaderData.data?.lines.map(line => (
          <li key={line.lineCode} className="rounded-lg w-full min-h-8 shadow-lg border-t-[16px] border-gray-100" style={{ borderTopColor: line.colorCode }}>
            <article className="p-4">
              <h1 className="font-bold text-xl">{line.name}</h1>
            </article>
            <ul className="border-t border-t-gray-300">
              {line.timetable.map(schedule => (
                <li key={schedule[0].id} className="p-4 flex items-start justify-between gap-2">
                  <div>
                    <span className="font-bold">{schedule[0].boundFor}</span>
                  </div>
                  <div className="text-right flex flex-col">
                    <span className="font-bold">{schedule[0].estimatedDeparture.toLocaleTimeString('id-ID', { timeStyle: 'short' })}</span>
                    {schedule.length > 1 ? (
                      <span className="font-bold text-sm text-gray-500">brkt {schedule.slice(1, 3).map(sched => sched.estimatedDeparture.toLocaleTimeString('id-ID', { timeStyle: 'short' })).join(', ')}</span>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </div>
  )
}
