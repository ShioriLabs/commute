import type { CompactLineTimetable, CompactSchedule } from 'models/schedules'
import { useState, useEffect, useMemo } from 'react'
import { Link } from 'react-router'
import { CaretRightIcon, NavigationArrowIcon } from '@phosphor-icons/react'
import { getForegroundColor, getTintFromColor } from 'utils/colors'
import { departureSortKey, getRelativeDepartureLabel, isImminentDeparture, parseMinute } from 'utils/schedules'
import { formatPlatformCode, joinLabels } from 'utils/labels'
import PidsChevrons from './pids-chevrons'

function getNextSchedules(
  schedules: CompactSchedule[],
  limit = 3
) {
  const now = new Date()
  const cutoff = now.getTime() - 60000 /* keep just departed trains */

  const upcoming = schedules
    .map(schedule => ({
      schedule,
      sortKey: departureSortKey(parseMinute(schedule[1]), now)
    }))
    .filter(entry => entry.sortKey >= cutoff)
    .sort((a, b) => a.sortKey - b.sortKey)
    .slice(0, limit)
    .map(entry => entry.schedule)

  if (upcoming.length === 0 && schedules.length > 0) {
    return [schedules[0]]
  }

  return upcoming
}

interface Props {
  line: CompactLineTimetable
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
        className="px-4 py-2.5 border-b-2"
        style={{ borderBottomColor: getTintFromColor(line.colorCode, 0.3) }}
        aria-labelledby={`line-name-${line.name}`}
      >
        {/* TJ has no line-detail (topology) page yet — render its cards unlinked. */}
        {operator && operator !== 'TJ'
          ? (
              <Link
                to={`/lines/${operator}/${line.lineCode}`}
                className="flex items-center justify-between gap-2"
                aria-label={`Lihat rute ${line.name}`}
              >
                <h1 id={`line-name-${line.name}`} className="font-bold text-base">{line.name}</h1>
                <CaretRightIcon weight="bold" className="w-4 h-4 text-slate-600" />
              </Link>
            )
          : (
              <h1 id={`line-name-${line.name}`} className="font-bold text-base">{line.name}</h1>
            )}
      </article>
      <ul>
        {upcomingGroups.map((group) => {
          // Synthetic/shimmed single-destination groups label themselves by
          // their terminus; a "menuju X" header over an "X" row is noise.
          // A platform badge still has to surface though, so keep the header
          // (minus the redundant label) whenever there is one to show.
          const labelIsRedundant = (
            group.destinations.length === 1
            && group.label.length === 1
            && group.label[0] === group.destinations[0].boundFor
          )
          const showHeader = !labelIsRedundant || Boolean(group.platformCode)

          return (
            <li
              key={group.key}
              className="border-t first:border-t-0"
              style={{ borderTopColor: getTintFromColor(line.colorCode, 0.3) }}
              aria-label={`Jadwal menuju ${group.label.join(', ')}`}
            >
              {showHeader && (
                <div
                  className="px-4 py-1.5 flex items-center gap-2"
                  style={{ backgroundColor: getTintFromColor(line.colorCode, 0.16) }}
                >
                  {!labelIsRedundant && (
                    <NavigationArrowIcon weight="fill" className="w-3 h-3 rotate-90 shrink-0" style={{ color: line.colorCode }} />
                  )}
                  <span className="flex-grow min-w-0 text-xs font-bold text-slate-700 uppercase tracking-wide truncate">
                    {labelIsRedundant ? '' : joinLabels(group.label)}
                  </span>
                  {group.platformCode && (
                    <span
                      className={`text-xs font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${getForegroundColor(line.colorCode) === 'LIGHT' ? 'text-white' : 'text-slate-900'}`}
                      style={{ backgroundColor: line.colorCode }}
                      aria-label={`Berangkat dari peron ${group.platformCode}`}
                    >
                      {'Peron '}
                      {formatPlatformCode(group.platformCode)}
                    </span>
                  )}
                </div>
              )}
              <ul>
                {group.destinations.map((destination) => {
                  const departure = parseMinute(destination.schedules[0][1])
                  const relativeLabel = getRelativeDepartureLabel(lastUpdated, departure)
                  const absoluteTime = departure.toLocaleTimeString('id-ID', { timeStyle: 'short' })
                  const imminent = isImminentDeparture(lastUpdated, departure)

                  return (
                    <li
                      key={`${destination.boundFor}${destination.via ? `:${destination.via}` : ''}`}
                      className="py-2.5 px-4 flex items-baseline justify-between gap-3"
                      aria-label={`Jadwal menuju ${destination.boundFor}`}
                    >
                      <div className="flex flex-col min-w-0">
                        <span className="text-sm text-slate-800 truncate">{destination.boundFor}</span>
                        { /* eslint-disable-next-line @stylistic/jsx-one-expression-per-line */ }
                        {destination.via && <span className="text-xs text-gray-500">via {destination.via}</span>}
                      </div>
                      <div className="text-right flex flex-col shrink-0">
                        <span className="flex items-center justify-end gap-1.5">
                          {imminent && <PidsChevrons color={line.colorCode} />}
                          {relativeLabel
                            ? (
                                <span className="text-2xl font-bold tabular-nums leading-tight" aria-label={relativeLabel === 'Sekarang' ? 'Keberangkatan berikutnya dalam beberapa menit' : `Keberangkatan berikutnya dalam ${relativeLabel.replace('mnt', 'menit')}`}>
                                  {relativeLabel}
                                </span>
                              )
                            : (
                                <span className="text-2xl font-bold tabular-nums leading-tight" aria-label={`Keberangkatan berikutnya pada ${absoluteTime}`}>
                                  {absoluteTime}
                                </span>
                              )}
                        </span>
                        {destination.schedules.length > 1
                          ? (
                              <span
                                className="text-sm tabular-nums text-gray-600"
                                aria-label={`Keberangkatan selanjutnya: ${destination.schedules.slice(1, 3).map(sched => parseMinute(sched[1]).toLocaleTimeString('id-ID', { timeStyle: 'short' })).join(', ')}`}
                              >
                                lalu
                                {' '}
                                {destination.schedules.slice(1, 3).map(sched => parseMinute(sched[1]).toLocaleTimeString('id-ID', { timeStyle: 'short' })).join(', ')}
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
