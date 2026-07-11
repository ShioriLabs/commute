import type { CompactLineTimetable, CompactSchedule, LineTimetable } from 'models/schedules'
import { useState, useEffect, useMemo } from 'react'
import { Link } from 'react-router'
import { CaretRightIcon } from '@phosphor-icons/react'
import { getTintFromColor } from 'utils/colors'
import { getRelativeDepartureLabel, parseTime } from 'utils/schedules'

function getNextSchedules(
  schedules: CompactSchedule[],
  limit = 3
) {
  const now = new Date()
  const today: CompactSchedule[] = []
  const tomorrow: CompactSchedule[] = []

  for (const schedule of schedules) {
    if (today.length + tomorrow.length === limit) break
    const parsedDeparture = parseTime(schedule.estimatedDeparture)

    if (
      parsedDeparture.getTime() < now.getTime()
      && parsedDeparture.getHours() < 4
      && now.getHours() >= 21
    ) {
      tomorrow.push(schedule)
      continue
    }

    if (parsedDeparture.getTime() >= now.getTime() - 60000 /* keep just departed trains */) {
      today.push(schedule)
    }
  }

  const returning = [...today, ...tomorrow]

  if (returning.length === 0 && schedules.length > 0) {
    returning.push(schedules[0])
  }

  return returning
}

interface Props {
  line: LineTimetable | CompactLineTimetable
  // When set, the card header links to the line's page (/lines/{operator}/{lineCode}).
  operator?: string
}

export default function LineCard({ line, operator }: Props) {
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date())

  useEffect(() => {
    setLastUpdated(new Date())
    const interval = setInterval(() => {
      setLastUpdated(new Date())
    }, 10000)
    return () => clearInterval(interval)
  }, [])

  const nextSchedulesFilteredTimetable = useMemo(() => {
    return line.timetable
      .map((direction) => {
        const schedules = getNextSchedules(direction.schedules)

        return {
          boundFor: direction.boundFor,
          via: direction.via,
          schedules
        }
      })
      .filter(direction => direction.schedules.length > 0)
  }, [line.timetable, lastUpdated])

  if (nextSchedulesFilteredTimetable.length === 0) return null

  return (
    <li
      className="rounded-xl w-full min-h-8 shadow-lg border-t-[16px] border-gray-100"
      style={{ borderTopColor: line.colorCode, backgroundColor: getTintFromColor(line.colorCode, 0.065) }}
      aria-label={`Jadwal untuk jalur ${line.name}`}
    >
      <article
        className="px-4 py-3 border-b-2"
        style={{ borderBottomColor: getTintFromColor(line.colorCode, 0.3) }}
        aria-labelledby={`line-name-${line.name}`}
      >
        {operator
          ? (
              <Link
                to={`/lines/${operator}/${line.lineCode}`}
                className="flex items-center justify-between gap-2"
                aria-label={`Lihat rute ${line.name}`}
              >
                <h1 id={`line-name-${line.name}`} className="font-bold text-lg">{line.name}</h1>
                <CaretRightIcon weight="bold" className="w-4 h-4 text-slate-600" />
              </Link>
            )
          : (
              <h1 id={`line-name-${line.name}`} className="font-bold text-lg">{line.name}</h1>
            )}
      </article>
      <ul>
        {nextSchedulesFilteredTimetable.map((direction) => {
          const departure = parseTime(direction.schedules[0].estimatedDeparture)
          const relativeLabel = getRelativeDepartureLabel(lastUpdated, departure)
          const absoluteTime = departure.toLocaleTimeString('id-ID', { timeStyle: 'short' })

          return (
            <li
              key={`${direction.boundFor}${direction.via ? `:${direction.via}` : ''}`}
              className="py-3 px-4 flex items-start justify-between border-t first:border-t-0"
              style={{ borderTopColor: getTintFromColor(line.colorCode, 0.3) }}
              aria-label={`Jadwal menuju ${direction.boundFor}`}
            >
              <div className="flex flex-col">
                <span className="font-semibold">{direction.boundFor}</span>
                { /* eslint-disable-next-line @stylistic/jsx-one-expression-per-line */ }
                {direction.via && <span className="text-sm text-gray-600">via {direction.via}</span>}
              </div>
              <div className="text-right flex flex-col">
                {relativeLabel
                  ? (
                      <span className="font-bold" aria-label={relativeLabel === 'Sekarang' ? 'Keberangkatan berikutnya dalam beberapa menit' : `Keberangkatan berikutnya dalam ${relativeLabel.replace('mnt', 'menit')}`}>
                        {relativeLabel}
                      </span>
                    )
                  : (
                      <span className="font-bold" aria-label={`Keberangkatan berikutnya pada ${absoluteTime}`}>
                        {absoluteTime}
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
