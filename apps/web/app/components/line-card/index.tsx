import type { CompactLineTimetable, CompactSchedule, LineTimetable } from 'models/schedules'
import { useState, useEffect, useMemo } from 'react'
import { Link } from 'react-router'
import { CaretRightIcon, NavigationArrowIcon } from '@phosphor-icons/react'
import { getForegroundColor, getTintFromColor } from 'utils/colors'
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

  const upcomingGroups = useMemo(() => {
    return line.timetable
      .map((group) => {
        const destinations = group.destinations
          .map(destination => ({
            boundFor: destination.boundFor,
            via: destination.via,
            schedules: getNextSchedules(destination.schedules)
          }))
          .filter(destination => destination.schedules.length > 0)

        return {
          key: group.key,
          label: group.label,
          platformCode: group.platformCode,
          destinations
        }
      })
      .filter(group => group.destinations.length > 0)
  }, [line.timetable, lastUpdated])

  if (upcomingGroups.length === 0) return null

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
        {upcomingGroups.map((group) => {
          // Synthetic/shimmed single-destination groups label themselves by
          // their terminus; a "menuju X" header over an "X" row is noise.
          const showHeader = !(
            group.destinations.length === 1
            && group.label.length === 1
            && group.label[0] === group.destinations[0].boundFor
          )

          return (
            <li
              key={group.key}
              className="border-t first:border-t-0"
              style={{ borderTopColor: getTintFromColor(line.colorCode, 0.3) }}
              aria-label={`Jadwal menuju ${group.label.join(', ')}`}
            >
              {showHeader && (
                <div
                  className="px-4 py-2 flex items-center gap-2"
                  style={{ backgroundColor: getTintFromColor(line.colorCode, 0.16) }}
                >
                  <NavigationArrowIcon weight="fill" className="w-3.5 h-3.5 rotate-90 shrink-0" style={{ color: line.colorCode }} />
                  <span className="flex-grow min-w-0 text-sm font-bold text-slate-800 truncate">
                    {group.label.join(' / ')}
                  </span>
                  {group.platformCode && (
                    <span
                      className={`text-xs font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${getForegroundColor(line.colorCode) === 'LIGHT' ? 'text-white' : 'text-slate-900'}`}
                      style={{ backgroundColor: line.colorCode }}
                      aria-label={`Berangkat dari peron ${group.platformCode}`}
                    >
                      {'Peron '}
                      {group.platformCode}
                    </span>
                  )}
                </div>
              )}
              <ul>
                {group.destinations.map((destination) => {
                  const departure = parseTime(destination.schedules[0].estimatedDeparture)
                  const relativeLabel = getRelativeDepartureLabel(lastUpdated, departure)
                  const absoluteTime = departure.toLocaleTimeString('id-ID', { timeStyle: 'short' })

                  return (
                    <li
                      key={`${destination.boundFor}${destination.via ? `:${destination.via}` : ''}`}
                      className="py-3 px-4 flex items-start justify-between"
                      aria-label={`Jadwal menuju ${destination.boundFor}`}
                    >
                      <div className="flex flex-col">
                        <span className="font-semibold">{destination.boundFor}</span>
                        { /* eslint-disable-next-line @stylistic/jsx-one-expression-per-line */ }
                        {destination.via && <span className="text-sm text-gray-600">via {destination.via}</span>}
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
                        {destination.schedules.length > 1
                          ? (
                              <span
                                className="font-semibold text-sm text-gray-600"
                                aria-label={`Keberangkatan selanjutnya: ${destination.schedules.slice(1, 3).map(sched => parseTime(sched.estimatedDeparture).toLocaleTimeString('id-ID', { timeStyle: 'short' })).join(', ')}`}
                              >
                                lalu
                                {' '}
                                {destination.schedules.slice(1, 3).map(sched => parseTime(sched.estimatedDeparture).toLocaleTimeString('id-ID', { timeStyle: 'short' })).join(', ')}
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
        })}
      </ul>
    </li>
  )
}
