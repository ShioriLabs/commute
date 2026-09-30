import type { CompactLineGroupedTimetable } from '@commute/schemas'
import { useMemo } from 'react'
import { getTintFromColor } from 'utils/colors'
import { parseMinute } from 'utils/schedules'
import { lastDepartures, serviceStartMinute } from 'utils/service-day'
import { useLines } from '~/hooks/use-lines'

const formatMinute = (minute: number) =>
  parseMinute(minute).toLocaleTimeString('id-ID', { timeStyle: 'short' })

/*
 * The last few departures to each destination, in service-day order.
 *
 * Answers the late-night question the upcoming board cannot: at 23.40 "next
 * in 6 mnt" does not say whether that is the train home or the one after it
 * is. Per destination rather than per direction, so a short-turn gets its own
 * row: the last train TOWARD Bogor can stop at Depok, and a rider needs to see
 * that before boarding it.
 *
 * A line that never stops (no overnight gap in its timetable) has no last
 * train and is left out, rather than showing whichever departures sort last by
 * the clock.
 */
export default function LastDepartures({ timetable }: { timetable: CompactLineGroupedTimetable }) {
  const { line: lookupLine } = useLines()

  const lines = useMemo(() => timetable.flatMap((line) => {
    const start = serviceStartMinute(line.timetable.flatMap(group =>
      group.destinations.flatMap(destination => destination.schedules.map(schedule => schedule[1]))))
    if (start === null) return []
    const destinations = line.timetable.flatMap(group => group.destinations.map(destination => ({
      key: `${group.key}:${destination.boundFor}:${destination.via ?? ''}`,
      boundFor: destination.boundFor,
      via: destination.via,
      times: lastDepartures(destination.schedules, start).map(schedule => schedule[1])
    }))).filter(destination => destination.times.length > 0)
    return destinations.length > 0 ? [{ line: line.line, destinations }] : []
  }), [timetable])

  if (lines.length === 0) return null

  return (
    <section className="mt-8">
      <h2 className="font-semibold text-lg px-4">Kereta terakhir</h2>
      <ul className="flex flex-col gap-2 mt-4">
        {lines.map(({ line, destinations }) => {
          const resolved = lookupLine(line)
          const lineColor = resolved?.colorCode ?? '#94a3b8'
          return (
            <li
              key={line}
              className="rounded-xl overflow-hidden"
              style={{ backgroundColor: getTintFromColor(lineColor, 0.065) }}
              aria-label={`Keberangkatan terakhir ${resolved?.name ?? line}`}
            >
              <div
                className="px-4 py-2 flex items-center gap-2 border-b-2"
                style={{ borderBottomColor: getTintFromColor(lineColor, 0.3) }}
              >
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: lineColor }} />
                <span className="font-bold text-sm">{resolved?.name ?? line}</span>
              </div>
              <ul>
                {destinations.map(destination => (
                  <li
                    key={destination.key}
                    className="px-4 py-2.5 flex items-baseline justify-between gap-3 border-t first:border-t-0"
                    style={{ borderTopColor: getTintFromColor(lineColor, 0.3) }}
                  >
                    <div className="flex flex-col min-w-0">
                      <span className="text-sm text-slate-800 truncate">{destination.boundFor}</span>
                      { /* eslint-disable-next-line @stylistic/jsx-one-expression-per-line */ }
                      {destination.via && <span className="text-xs text-gray-500">via {destination.via}</span>}
                    </div>
                    <span className="flex gap-3 shrink-0 tabular-nums text-base">
                      {destination.times.map((minute, i) => (
                        <span
                          key={minute}
                          className={i === destination.times.length - 1 ? 'font-bold text-slate-900' : 'text-slate-600'}
                          aria-label={i === destination.times.length - 1 ? `Terakhir ${formatMinute(minute)}` : undefined}
                        >
                          {formatMinute(minute)}
                        </span>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
