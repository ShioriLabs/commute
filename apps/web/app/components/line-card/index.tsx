import type { LineTimetable, Schedule } from 'models/schedules'
import { useState, useEffect, useMemo } from 'react'
import { getTintFromColor } from 'utils/colors'

function parseTime(timeString: string) {
  return new Date(`${new Date().toDateString()} ${timeString}`)
}

function getNextSchedules(schedules: Schedule[], limit = 3) {
  const now = new Date()
  const returning: Schedule[] = []
  for (const schedule of schedules) {
    if (returning.length === limit) break
    const parsedDeparture = parseTime(schedule.estimatedDeparture)
    const diff = parsedDeparture.getTime() - now.getTime()

    // Allow departure that happened within the last 1 minute
    if (diff < -60000) continue
    returning.push(schedule)
  }

  return returning
}

function isImmediateDeparture(now: Date, scheduledDeparture: Date) {
  const diff = scheduledDeparture.getTime() - now.getTime()
  return diff >= -60000 && diff <= 30000
}

interface Props {
  line: LineTimetable
}

export default function LineCard({ line }: Props) {
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date())

  useEffect(() => {
    setLastUpdated(new Date())
    const interval = setInterval(() => {
      setLastUpdated(new Date())
    }, 10000)
    return () => clearInterval(interval)
  }, [])

  const nextSchedulesFilteredTimetable = useMemo(() => {
    return line.timetable.map((direction) => {
      return {
        boundFor: direction.boundFor,
        schedules: getNextSchedules(direction.schedules)
      }
    }).filter(direction => direction.schedules.length > 0)
  }, [line.timetable, lastUpdated])

  if (nextSchedulesFilteredTimetable.length === 0) return null

  return (
    <li
      className="rounded-xl w-full min-h-8 shadow-lg border-t-[16px] border-gray-100"
      style={{ borderTopColor: line.colorCode, backgroundColor: getTintFromColor(line.colorCode, 0.065) }}
      aria-label={`Jadwal untuk jalur ${line.name}`}
    >
      <article
        className="p-4 border-b-2"
        style={{ borderBottomColor: getTintFromColor(line.colorCode, 0.3) }}
        aria-labelledby={`line-name-${line.name}`}
      >
        <h1 id={`line-name-${line.name}`} className="font-bold text-xl">{line.name}</h1>
      </article>
      <ul>
        {nextSchedulesFilteredTimetable.map((direction) => {
          return (
            <li
              key={direction.boundFor}
              className="p-4 flex items-start justify-between border-t first:border-t-0"
              style={{ borderTopColor: getTintFromColor(line.colorCode, 0.3) }}
              aria-label={`Jadwal menuju ${direction.boundFor}`}
            >
              <div>
                <span className="font-semibold">{direction.boundFor}</span>
              </div>
              <div className="text-right flex flex-col">
                {isImmediateDeparture(lastUpdated, parseTime(direction.schedules[0].estimatedDeparture))
                  ? (
                      <span className="font-bold animate-pulse" style={{ color: line.colorCode }} aria-label="Keberangkatan berikutnya akan tiba sebentar lagi">
                        {parseTime(direction.schedules[0].estimatedDeparture).toLocaleTimeString('id-ID', { timeStyle: 'short' })}
                      </span>
                    )
                  : (
                      <span className="font-bold" aria-label={`Keberangkatan berikutnya pada ${parseTime(direction.schedules[0].estimatedDeparture).toLocaleTimeString('id-ID', { timeStyle: 'short' })}`}>
                        {parseTime(direction.schedules[0].estimatedDeparture).toLocaleTimeString('id-ID', { timeStyle: 'short' })}
                      </span>
                    )}
                {direction.schedules.length > 1
                  ? (
                      <span
                        className="font-semibold text-sm text-gray-600"
                        aria-label={`Keberangkatan selanjutnya: ${direction.schedules.slice(1, 3).map(sched => parseTime(sched.estimatedDeparture).toLocaleTimeString('id-ID', { timeStyle: 'short' })).join(', ')}`}
                      >
                        lalu
                        {' '}
                        {direction.schedules.slice(1, 3).map(sched => parseTime(sched.estimatedDeparture).toLocaleTimeString('id-ID', { timeStyle: 'short' })).join(', ')}
                      </span>
                    )
                  : null}
              </div>
            </li>
          )
        })}
      </ul>
    </li>
  )
}
