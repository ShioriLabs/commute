import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import useSWR from 'swr'
import { Popover, PopoverButton, PopoverPanel } from '@headlessui/react'
import { CaretDownIcon, WarningIcon } from '@phosphor-icons/react'
import type { StandardResponse } from '@schema/response'
import type { CompactLineGroupedTimetable } from 'models/schedules'
import EmptyState from '~/components/empty-state'
import { fetcher } from 'utils/fetcher'
import { useNetworkStatus } from '~/hooks/network'
import { getForegroundColor } from 'utils/colors'
import { isImmediateDeparture, parseTime } from 'utils/schedules'

const swrConfig = {
  dedupingInterval: import.meta.env.DEV ? 0 : 60 * 60 * 1000,
  focusThrottleInterval: import.meta.env.DEV ? 0 : 60 * 60 * 1000,
  revalidateOnFocus: true,
  shouldRetryOnError: false
}

interface DepartureRow {
  scheduleId: string
  lineCode: string
  lineName: string
  lineColor: `#${string}`
  boundFor: string
  via: string | null
  estimatedDeparture: string
  sortKey: number
}

function buildRows(timetable: CompactLineGroupedTimetable, now: Date): DepartureRow[] {
  const rows: DepartureRow[] = []
  const lateNight = now.getHours() >= 21

  for (const line of timetable) {
    for (const direction of line.timetable) {
      for (const schedule of direction.schedules) {
        const parsed = parseTime(schedule.estimatedDeparture)
        let sortKey = parsed.getTime()
        if (lateNight && parsed.getHours() < 4) {
          sortKey += 24 * 60 * 60 * 1000
        }
        rows.push({
          scheduleId: schedule.id,
          lineCode: line.lineCode,
          lineName: line.name,
          lineColor: line.colorCode,
          boundFor: direction.boundFor,
          via: direction.via,
          estimatedDeparture: schedule.estimatedDeparture,
          sortKey
        })
      }
    }
  }

  rows.sort((a, b) => a.sortKey - b.sortKey)
  return rows
}

function findNearestIndex(rows: DepartureRow[], now: Date) {
  const cutoff = now.getTime() - 60000
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].sortKey >= cutoff) return i
  }
  return -1
}

interface LineMeta {
  lineCode: string
  name: string
  colorCode: `#${string}`
}

interface Props {
  operator: string
  code: string
}

const TimetableContent = memo(function TimetableContent({ operator, code }: Props) {
  const timetableUrl = useMemo(() =>
    new URL(`/stations/${operator}/${code}/timetable/grouped?compact=1`, import.meta.env.VITE_API_BASE_URL).href,
  [operator, code]
  )

  const timetable = useSWR<StandardResponse<CompactLineGroupedTimetable>>(timetableUrl, fetcher, swrConfig)
  const networkStatus = useNetworkStatus()

  const [lastUpdated, setLastUpdated] = useState<Date>(new Date())

  useEffect(() => {
    setLastUpdated(new Date())
    const interval = setInterval(() => {
      setLastUpdated(new Date())
    }, 10000)
    return () => clearInterval(interval)
  }, [])

  const lines: LineMeta[] = useMemo(() => {
    if (!timetable.data?.data) return []
    return timetable.data.data.map(line => ({
      lineCode: line.lineCode,
      name: line.name,
      colorCode: line.colorCode
    }))
  }, [timetable.data])

  const [excludedLines, setExcludedLines] = useState<Set<string>>(new Set())

  const toggleLine = useCallback((lineCode: string) => {
    setExcludedLines((prev) => {
      const next = new Set(prev)
      if (next.has(lineCode)) {
        next.delete(lineCode)
      } else {
        next.add(lineCode)
      }
      return next
    })
  }, [])

  const allRows = useMemo(() => {
    if (!timetable.data?.data) return []
    return buildRows(timetable.data.data, lastUpdated)
  }, [timetable.data, lastUpdated])

  const visibleRows = useMemo(() => {
    if (excludedLines.size === 0) return allRows
    return allRows.filter(row => !excludedLines.has(row.lineCode))
  }, [allRows, excludedLines])

  const nearestIndex = useMemo(() =>
    findNearestIndex(visibleRows, lastUpdated),
  [visibleRows, lastUpdated]
  )

  const nearestRowRef = useRef<HTMLLIElement | null>(null)
  const hasScrolledRef = useRef(false)

  useEffect(() => {
    if (hasScrolledRef.current) return
    if (!timetable.data?.data?.length) return
    if (!nearestRowRef.current) return
    nearestRowRef.current.scrollIntoView({ block: 'center', behavior: 'auto' })
    hasScrolledRef.current = true
  }, [timetable.data])

  if (timetable.isLoading) {
    return (
      <div className="px-4 pb-8 mt-2 flex flex-col gap-2 max-w-3xl mx-auto">
        <div className="animate-pulse w-full h-72 bg-slate-200 rounded-lg" />
      </div>
    )
  }

  if (!timetable.data?.data?.length) {
    if (networkStatus === 'OFFLINE') return <EmptyState mode="OFFLINE" onRetry={() => timetable.mutate()} />
    if (timetable.error) return <EmptyState mode="ERROR" onRetry={() => timetable.mutate()} />
    return <EmptyState mode="NO_DATA" />
  }

  return (
    <div className="flex flex-col max-w-3xl mx-auto pb-8 mt-2">
      {networkStatus === 'OFFLINE' && (
        <div className="mx-4 text-amber-950 bg-amber-100 flex flex-row gap-2 rounded-xl p-4 font-semibold mb-4">
          <WarningIcon weight="duotone" className="w-6 h-6" />
          Kamu sedang offline, data mungkin tidak up-to-date
        </div>
      )}

      <div className="px-4 mb-2 flex items-center">
        <Popover className="relative">
          <PopoverButton className="flex items-center gap-1.5 text-sm font-semibold text-slate-700 px-3 py-1.5 rounded-full bg-slate-100 hover:bg-slate-200 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F55875]">
            Filter Jalur
            {excludedLines.size > 0 && (
              <span className="font-bold text-[#F55875]">
                ·
                {' '}
                {lines.length - excludedLines.size}
                /
                {lines.length}
              </span>
            )}
            <CaretDownIcon weight="bold" className="w-3 h-3" />
          </PopoverButton>
          <PopoverPanel
            anchor="bottom start"
            className="z-20 mt-2 min-w-56 rounded-xl bg-white shadow-lg border border-slate-100 p-2 flex flex-col gap-1 focus:outline-none"
          >
            {lines.map((line) => {
              const isActive = !excludedLines.has(line.lineCode)
              return (
                <button
                  key={line.lineCode}
                  type="button"
                  onClick={() => toggleLine(line.lineCode)}
                  className="flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-slate-50 cursor-pointer text-left"
                  aria-pressed={isActive}
                >
                  <LineBadge code={line.lineCode} color={line.colorCode} dimmed={!isActive} />
                  <span className={`text-sm font-semibold ${isActive ? 'text-slate-900' : 'text-slate-400 line-through'}`}>
                    {line.name}
                  </span>
                </button>
              )
            })}
          </PopoverPanel>
        </Popover>
      </div>

      {visibleRows.length === 0
        ? (
            <p className="text-center text-gray-600 mt-8 px-4">Tidak ada jadwal untuk jalur yang dipilih</p>
          )
        : (
            <ul className="flex flex-col">
              {visibleRows.map((row, index) => {
                const parsed = parseTime(row.estimatedDeparture)
                const isNearest = index === nearestIndex
                const isImminent = isNearest && isImmediateDeparture(lastUpdated, parsed)
                const timeText = parsed.toLocaleTimeString('id-ID', { timeStyle: 'short' })

                let timeClass = 'tabular-nums text-sm font-semibold text-slate-700'
                let timeStyle: React.CSSProperties | undefined
                let ariaLabel = `${row.lineName} menuju ${row.boundFor}${row.via ? ` via ${row.via}` : ''} pada ${timeText}`

                if (isImminent) {
                  timeClass = 'tabular-nums text-sm font-bold animate-pulse'
                  timeStyle = { color: row.lineColor }
                  ariaLabel = `Keberangkatan berikutnya: ${ariaLabel}, akan tiba sebentar lagi`
                } else if (isNearest) {
                  timeClass = 'tabular-nums text-sm font-bold'
                  timeStyle = { color: row.lineColor }
                  ariaLabel = `Keberangkatan berikutnya: ${ariaLabel}`
                }

                return (
                  <li
                    key={row.scheduleId}
                    ref={isNearest ? nearestRowRef : undefined}
                    className="flex items-center gap-3 px-4 py-3 border-b border-slate-100 last:border-b-0"
                    aria-label={ariaLabel}
                  >
                    <LineBadge code={row.lineCode} color={row.lineColor} />
                    <div className="flex flex-col flex-grow min-w-0">
                      <span className="text-sm font-semibold text-slate-900 truncate">{row.boundFor}</span>
                      {row.via && (
                        <span className="text-xs text-slate-500 truncate">
                          via
                          {' '}
                          {row.via}
                        </span>
                      )}
                    </div>
                    <span className={timeClass} style={timeStyle}>
                      {timeText}
                    </span>
                  </li>
                )
              })}
            </ul>
          )}
    </div>
  )
})

interface LineBadgeProps {
  code: string
  color: `#${string}`
  dimmed?: boolean
}

function LineBadge({ code, color, dimmed = false }: LineBadgeProps) {
  const textColor = getForegroundColor(color) === 'LIGHT' ? 'text-white' : 'text-slate-900'
  return (
    <span
      className={`inline-flex items-center justify-center w-9 h-9 rounded-lg text-xs font-bold shrink-0 ${textColor} ${dimmed ? 'opacity-30' : ''}`}
      style={{ backgroundColor: color }}
      aria-hidden="true"
    >
      {code}
    </span>
  )
}

export default TimetableContent
