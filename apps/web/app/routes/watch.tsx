import { useCallback, useEffect, useMemo, useState } from 'react'
import useSWR from 'swr'
import type { Station } from 'models/stations'
import type { CompactLineGroupedTimetable, CompactTimetableDirectionGroup } from 'models/schedules'
import type { StandardResponse } from '@schema/response'
import { fetcher } from 'utils/fetcher'
import { normalizeGroupedTimetable } from 'utils/timetable-shim'
import { getNextSchedules, getRelativeDepartureLabel, parseTime } from 'utils/schedules'

// Watch glance: a round-safe, dark, text-only view of next departures for the
// user's saved stations. One station at a time; tap or turn the bezel (wheel /
// arrow keys) to cycle. Reuses the exact data path the phone home screen uses.

export function meta() {
  return [
    { title: 'Commute Watch' },
    { name: 'theme-color', content: '#000000' },
    // Fit the watch viewport; Wear OS browser honours the meta viewport.
    { name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' }
  ]
}

// Schedules are fixed timetables, not live positions — dedupe hard so the watch
// never hammers the API (mirrors the home screen's swrConfig).
const swrConfig = {
  dedupingInterval: import.meta.env.DEV ? 0 : 60 * 60 * 1000,
  focusThrottleInterval: import.meta.env.DEV ? 0 : 60 * 60 * 1000,
  revalidateOnFocus: false,
  shouldRetryOnError: false
}

function readSavedStations(): string[] {
  const raw = localStorage.getItem('saved-stations')
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as string[]) : []
  } catch {
    return []
  }
}

// A single departure time, rendered relative ("3 mnt" / "Sekarang") when close,
// else absolute HH:MM.
function departureLabel(now: Date, estimatedDeparture: string): string {
  const departure = parseTime(estimatedDeparture)
  return (
    getRelativeDepartureLabel(now, departure)
    ?? departure.toLocaleTimeString('id-ID', { timeStyle: 'short' })
  )
}

function DirectionRow({ group, now }: { group: CompactTimetableDirectionGroup, now: Date }) {
  return (
    <div className="w-full">
      {group.destinations.map((destination) => {
        const next = getNextSchedules(destination.schedules, now, 2)
        if (next.length === 0) return null
        return (
          <div key={destination.boundFor + (destination.via ?? '')} className="flex items-baseline gap-2 py-1">
            <span className="flex-grow truncate text-[4.2vw] font-semibold text-white">
              {destination.boundFor}
              {destination.via && (
                <span className="text-white/60 font-normal">
                  {' '}
                  via
                  {' '}
                  {destination.via}
                </span>
              )}
            </span>
            <span className="shrink-0 text-[4.2vw] font-bold tabular-nums text-white">
              {next.map(sched => departureLabel(now, sched.estimatedDeparture)).join(' · ')}
            </span>
          </div>
        )
      })}
    </div>
  )
}

function StationGlance({ stationId }: { stationId: string }) {
  const [operator, code] = stationId.split(/-/g)
  const base = import.meta.env.VITE_API_BASE_URL
  const station = useSWR<StandardResponse<Station>>(new URL(`/stations/${operator}/${code}`, base).href, fetcher, swrConfig)
  const timetable = useSWR<StandardResponse<CompactLineGroupedTimetable>>(
    new URL(`/stations/${operator}/${code}/timetable/grouped?compact=1`, base).href,
    fetcher,
    swrConfig
  )
  const timetableData = useMemo(() => normalizeGroupedTimetable(timetable.data?.data), [timetable.data])

  // Tick every 15s so relative labels ("3 mnt") stay honest without churn.
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 15000)
    return () => clearInterval(id)
  }, [])

  const stationName = station.data?.data?.formattedName ?? station.data?.data?.name ?? '…'

  return (
    <div className="flex h-full w-full flex-col">
      <h1 className="mb-1 shrink-0 truncate text-center text-[5vw] font-bold text-white">
        {stationName}
      </h1>
      <div className="no-scrollbar flex-grow overflow-y-auto">
        {timetable.isLoading
          ? (
              <p className="pt-4 text-center text-[4vw] text-white/60">Memuat…</p>
            )
          : timetableData?.length
            ? (
                <div className="flex flex-col gap-2">
                  {timetableData.map(line => (
                    <div key={line.lineCode}>
                      <div className="flex items-center gap-1.5">
                        <span
                          className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                          style={{ backgroundColor: line.colorCode }}
                          aria-hidden="true"
                        />
                        <span className="truncate text-[3.6vw] font-semibold text-white/70">{line.name}</span>
                      </div>
                      {line.timetable.map(group => (
                        <DirectionRow key={group.key} group={group} now={now} />
                      ))}
                    </div>
                  ))}
                </div>
              )
            : (
                <p className="pt-4 text-center text-[4vw] text-white/60">
                  {timetable.error ? 'Gagal memuat jadwal' : 'Jadwal tidak tersedia'}
                </p>
              )}
      </div>
    </div>
  )
}

export default function WatchPage() {
  const [stations, setStations] = useState<string[] | null>(null)
  const [index, setIndex] = useState(0)

  useEffect(() => {
    setStations(readSavedStations())
  }, [])

  const count = stations?.length ?? 0
  const advance = useCallback(() => {
    if (count > 1) setIndex(i => (i + 1) % count)
  }, [count])

  // Turning the Galaxy Watch5 bezel emits wheel events; arrow keys as fallback.
  useEffect(() => {
    if (count <= 1) return
    const onWheel = () => advance()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowRight') advance()
      if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') setIndex(i => (i - 1 + count) % count)
    }
    window.addEventListener('wheel', onWheel, { passive: true })
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('wheel', onWheel)
      window.removeEventListener('keydown', onKey)
    }
  }, [advance, count])

  return (
    // Full-bleed black; the inner square inset keeps content clear of the round
    // bezel (~11% padding ≈ the corner clip on a circular display).
    <main
      className="fixed inset-0 select-none bg-black"
      onClick={advance}
      role={count > 1 ? 'button' : undefined}
      tabIndex={count > 1 ? 0 : undefined}
      aria-label={count > 1 ? 'Ketuk untuk stasiun berikutnya' : undefined}
    >
      <div className="absolute inset-[11%] flex flex-col">
        {stations === null
          ? (
              <div className="m-auto h-8 w-8 animate-spin rounded-full border-4 border-white/30 border-t-transparent" aria-label="Memuat" />
            )
          : count === 0
            ? (
                <p className="m-auto text-center text-[4.4vw] leading-snug text-white/80">
                  Belum ada stasiun. Buka Commute di HP buat simpan stasiun.
                </p>
              )
            : (
                <StationGlance key={stations[index]} stationId={stations[index]} />
              )}
      </div>

      {count > 1 && (
        <div className="absolute inset-x-0 bottom-[6%] flex justify-center gap-1.5" aria-hidden="true">
          {stations!.map((id, i) => (
            <span
              key={id}
              className={`h-1.5 w-1.5 rounded-full ${i === index ? 'bg-white' : 'bg-white/30'}`}
            />
          ))}
        </div>
      )}
    </main>
  )
}
