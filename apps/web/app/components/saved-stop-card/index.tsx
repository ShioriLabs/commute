import clsx from 'clsx'
import { CaretRightIcon } from '@phosphor-icons/react'
import type { CompactLineGroupedTimetable } from 'models/schedules'
import { deriveSavedStopRows } from 'utils/saved-stops'
import { getRelativeDepartureLabel, isImminentDeparture } from 'utils/schedules'
import { formatPlatformCode } from 'utils/labels'
import LineRoundel from '../line-roundel'
import { sortLinesForDisplay } from '~/utils/lines'

interface Props {
  stationId: string
  operator: string
  formattedName: string
  lines: Array<{ lineCode: string, name: string, colorCode: `#${string}` }>
  timetable: CompactLineGroupedTimetable | undefined
  // Shared clock, ticked once by the host so N cards don't run N timers.
  now: Date
  onSelect: (stationId: string) => void
}

function departureLabel(now: Date, departure: Date): string {
  const relative = getRelativeDepartureLabel(now, departure)
  if (relative) return relative
  return departure.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })
}

export default function SavedStopCard({
  stationId,
  operator,
  formattedName,
  lines,
  timetable,
  now,
  onSelect
}: Props) {
  const { rows, truncatedCount } = deriveSavedStopRows(timetable, now)

  return (
    <li>
      <article className="rounded-xl border border-slate-200 overflow-hidden bg-white">
        <button
          type="button"
          onClick={() => onSelect(stationId)}
          className="w-full flex items-center gap-2 px-3 py-2.5 bg-slate-50 text-left cursor-pointer hover:bg-slate-100 transition-colors"
          aria-label={`Lihat stasiun ${formattedName} di peta`}
        >
          {lines.length > 0 && (
            <span className="flex flex-row gap-1 shrink-0">
              {sortLinesForDisplay(lines, operator).slice(0, 3).map(line => (
                <LineRoundel
                  key={line.lineCode}
                  size="SM"
                  code={line.lineCode}
                  color={line.colorCode}
                  operator={operator}
                />
              ))}
            </span>
          )}
          <h3 className="font-bold text-slate-900 truncate flex-1">{formattedName}</h3>
          <CaretRightIcon weight="bold" className="w-4 h-4 text-slate-400 shrink-0" />
        </button>

        {rows.length === 0
          ? (
              <p className="px-3 py-3 text-sm text-slate-500">Jadwal tidak tersedia</p>
            )
          : (
              <ul>
                {rows.map((row) => {
                  const imminent = isImminentDeparture(now, row.departure)
                  return (
                    <li
                      key={row.key}
                      className="flex items-center gap-2 px-3 py-2 border-t border-slate-100"
                    >
                      <span
                        className="w-1.5 self-stretch rounded-full shrink-0"
                        style={{ backgroundColor: row.colorCode }}
                        aria-hidden="true"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold text-slate-900 truncate">
                          {row.boundFor}
                        </span>
                        <span className="block text-xs text-slate-500">
                          {row.lineName}
                          {row.platformCode && ` · Peron ${formatPlatformCode(row.platformCode)}`}
                        </span>
                      </span>
                      <span
                        className={clsx(
                          'text-sm font-bold tabular-nums shrink-0',
                          imminent ? 'text-[#F55875]' : 'text-slate-900'
                        )}
                      >
                        {departureLabel(now, row.departure)}
                      </span>
                    </li>
                  )
                })}
              </ul>
            )}

        {truncatedCount > 0 && (
          <p className="px-3 pb-2 text-xs text-slate-400 tabular-nums">
            {truncatedCount}
            +
            <span className="sr-only">
              {` arah lain tidak ditampilkan. Buka stasiun untuk melihat semuanya.`}
            </span>
          </p>
        )}
      </article>
    </li>
  )
}
