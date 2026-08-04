import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import useSWR from 'swr'
import { Popover, PopoverButton, PopoverPanel } from '@headlessui/react'
import { CaretDownIcon, WarningIcon } from '@phosphor-icons/react'
import type { StandardResponse } from '@schema/response'
import type { CompactLineGroupedTimetable, Line } from '@commute/schemas'
import EmptyState from '~/components/empty-state'
import LineRoundel from '~/components/line-roundel'
import { fetcher } from 'utils/fetcher'
import { normalizeGroupedTimetable } from 'utils/timetable-shim'
import { useNetworkStatus } from '~/hooks/network'
import { codeOfLineKey, useLines } from '~/hooks/use-lines'
import { useClock } from '~/hooks/clock'
import { departureSortKey, isImmediateDeparture, parseMinute } from 'utils/schedules'
import { formatPlatformCode, joinLabels } from 'utils/labels'

const swrConfig = {
  dedupingInterval: import.meta.env.DEV ? 0 : 60 * 60 * 1000,
  focusThrottleInterval: import.meta.env.DEV ? 0 : 60 * 60 * 1000,
  revalidateOnFocus: true,
  shouldRetryOnError: false
}

interface DepartureRow {
  tripNumber: string | null
  boundFor: string
  via: string | null
  minute: number
  sortKey: number
}

interface DirectionSection {
  key: string
  lineCode: string
  lineName: string
  lineColor: `#${string}`
  label: string[]
  platformCode: string | null
  rows: DepartureRow[]
}

/*
 * `resolveLine` turns the timetable's line key into its name and colour. Passed
 * in rather than looked up here so this stays a pure function.
 */
function buildSections(
  timetable: CompactLineGroupedTimetable,
  now: Date,
  resolveLine: (key: string) => Line | undefined
): DirectionSection[] {
  const sections: DirectionSection[] = []

  for (const line of timetable) {
    for (const group of line.timetable) {
      const rows: DepartureRow[] = []
      for (const destination of group.destinations) {
        for (const schedule of destination.schedules) {
          const parsed = parseMinute(schedule[1])
          const sortKey = departureSortKey(parsed, now)
          rows.push({
            tripNumber: schedule[0],
            boundFor: destination.boundFor,
            via: destination.via,
            minute: schedule[1],
            sortKey
          })
        }
      }
      rows.sort((a, b) => a.sortKey - b.sortKey)
      sections.push({
        key: `${line.line}:${group.key}`,
        lineCode: codeOfLineKey(line.line),
        lineName: resolveLine(line.line)?.name ?? codeOfLineKey(line.line),
        lineColor: resolveLine(line.line)?.colorCode ?? '#94a3b8',
        label: group.label,
        platformCode: group.platformCode,
        rows
      })
    }
  }

  return sections
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
  const { line: resolveLine } = useLines()
  const timetableUrl = useMemo(() =>
    new URL(`/stations/${operator}/${code}/timetable/grouped?compact=1`, import.meta.env.VITE_API_BASE_URL).href,
  [operator, code]
  )

  const timetable = useSWR<StandardResponse<CompactLineGroupedTimetable>>(timetableUrl, fetcher, swrConfig)
  const timetableData = useMemo(() => normalizeGroupedTimetable(timetable.data?.data), [timetable.data])
  const networkStatus = useNetworkStatus()

  const nowMs = useClock()
  const lastUpdated = useMemo(() => new Date(nowMs), [nowMs])

  const lines: LineMeta[] = useMemo(() => {
    if (!timetableData) return []
    return timetableData.map(line => ({
      lineCode: codeOfLineKey(line.line),
      name: resolveLine(line.line)?.name ?? codeOfLineKey(line.line),
      colorCode: resolveLine(line.line)?.colorCode ?? '#94a3b8'
    }))
  }, [timetableData, resolveLine])

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

  // buildSections reads the clock coarsely — parseMinute pins rows to today's
  // date and departureSortKey branches on the late-night window (>= 21:00) —
  // so key the rebuild on those boundaries, not the 10s tick that used to
  // throw away and re-sort every section.
  const dayKey = lastUpdated.toDateString()
  const isLateNight = lastUpdated.getHours() >= 21
  const allSections = useMemo(() => {
    if (!timetableData) return []
    const coarseNow = new Date(dayKey)
    coarseNow.setHours(isLateNight ? 21 : 12)
    return buildSections(timetableData, coarseNow, resolveLine)
  }, [timetableData, dayKey, isLateNight, resolveLine])

  const visibleSections = useMemo(() => {
    if (excludedLines.size === 0) return allSections
    return allSections.filter(section => !excludedLines.has(section.lineCode))
  }, [allSections, excludedLines])

  // Each section highlights its own next departure; the initial scroll lands
  // on the globally soonest upcoming one across visible sections.
  const nearestBySection = useMemo(() => {
    const nearest = new Map<string, number>()
    for (const section of visibleSections) {
      nearest.set(section.key, findNearestIndex(section.rows, lastUpdated))
    }
    return nearest
  }, [visibleSections, lastUpdated])

  const globalNearest = useMemo(() => {
    let best: { sectionKey: string, sortKey: number } | null = null
    for (const section of visibleSections) {
      const index = nearestBySection.get(section.key) ?? -1
      if (index === -1) continue
      const row = section.rows[index]
      if (!best || row.sortKey < best.sortKey) {
        best = { sectionKey: section.key, sortKey: row.sortKey }
      }
    }
    return best
  }, [visibleSections, nearestBySection])

  const nearestRowRef = useRef<HTMLLIElement | null>(null)
  const hasScrolledRef = useRef(false)

  useEffect(() => {
    if (hasScrolledRef.current) return
    if (!timetableData?.length) return
    if (!nearestRowRef.current) return
    nearestRowRef.current.scrollIntoView({ block: 'center', behavior: 'auto' })
    hasScrolledRef.current = true
  }, [timetableData])

  if (timetable.isLoading) {
    return (
      <div className="px-4 pb-8 mt-2 flex flex-col gap-2 max-w-3xl mx-auto">
        <div className="animate-pulse w-full h-72 bg-slate-200 rounded-lg" />
      </div>
    )
  }

  if (!timetableData?.length) {
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
                  <LineRoundel code={line.lineCode} color={line.colorCode} operator={operator} dimmed={!isActive} />
                  <span className={`text-sm font-semibold ${isActive ? 'text-slate-900' : 'text-slate-400 line-through'}`}>
                    {line.name}
                  </span>
                </button>
              )
            })}
          </PopoverPanel>
        </Popover>
      </div>

      {visibleSections.length === 0
        ? (
            <p className="text-center text-gray-600 mt-8 px-4">Tidak ada jadwal untuk jalur yang dipilih</p>
          )
        : (
            visibleSections.map((section) => {
              const nearestIndex = nearestBySection.get(section.key) ?? -1
              const isGlobalNearestSection = globalNearest?.sectionKey === section.key

              return (
                <section key={section.key} aria-label={`Keberangkatan ${section.lineName} menuju ${section.label.join(', ')}`}>
                  {/* Sticks below the page header (p-8/pb-4 + two text lines = 6rem). */}
                  {/* 6rem clears the standalone page's sticky header. Inside a
                      pushed pane the scroll container is the card body and
                      there is nothing above these, so the pane sets the var to
                      0. */}
                  <header className="sticky top-[var(--timetable-sticky-top,6rem)] z-[9] flex items-center gap-3 px-4 py-2.5 bg-white/90 backdrop-blur border-b border-slate-100">
                    <LineRoundel code={section.lineCode} color={section.lineColor} operator={operator} />
                    <span className="flex-grow min-w-0 text-sm font-bold text-slate-900 truncate">
                      {'menuju '}
                      {joinLabels(section.label)}
                    </span>
                    {section.platformCode && (
                      <span
                        className="text-xs font-bold px-2 py-0.5 rounded-full whitespace-nowrap text-slate-900"
                        style={{ backgroundColor: `${section.lineColor}33` }}
                        aria-label={`Berangkat dari peron ${section.platformCode}`}
                      >
                        {'Peron '}
                        {formatPlatformCode(section.platformCode)}
                      </span>
                    )}
                  </header>
                  <ul className="flex flex-col mb-4">
                    {section.rows.map((row, index) => {
                      const parsed = parseMinute(row.minute)
                      const isNearest = index === nearestIndex
                      const isImminent = isNearest && isImmediateDeparture(lastUpdated, parsed)
                      const timeText = parsed.toLocaleTimeString('id-ID', { timeStyle: 'short' })

                      let timeClass = 'tabular-nums text-sm font-semibold text-slate-700'
                      let timeStyle: React.CSSProperties | undefined
                      let ariaLabel = `${section.lineName} menuju ${row.boundFor}${row.via ? ` via ${row.via}` : ''} pada ${timeText}`

                      if (isImminent) {
                        timeClass = 'tabular-nums text-sm font-bold animate-pulse'
                        timeStyle = { color: section.lineColor }
                        ariaLabel = `Keberangkatan berikutnya: ${ariaLabel}, akan tiba sebentar lagi`
                      } else if (isNearest) {
                        timeClass = 'tabular-nums text-sm font-bold'
                        timeStyle = { color: section.lineColor }
                        ariaLabel = `Keberangkatan berikutnya: ${ariaLabel}`
                      }

                      return (
                        <li
                          key={`${section.key}:${row.tripNumber ?? index}`}
                          ref={isNearest && isGlobalNearestSection ? nearestRowRef : undefined}
                          className="flex items-center gap-3 px-4 py-3 border-b border-slate-100 last:border-b-0"
                          aria-label={ariaLabel}
                        >
                          <div className="flex flex-col flex-grow min-w-0">
                            <span className={`text-sm ${isNearest ? 'font-bold' : 'font-semibold'} text-slate-900 truncate`}>
                              {row.boundFor}
                            </span>
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
                </section>
              )
            })
          )}
    </div>
  )
})

export default TimetableContent
