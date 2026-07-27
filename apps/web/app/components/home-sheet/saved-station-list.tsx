import { useMemo } from 'react'
import useSWR from 'swr'
import type { StandardResponse } from '@schema/response'
import type { Station } from 'models/stations'
import type { CompactLineGroupedTimetable } from 'models/schedules'
import { fetcher } from 'utils/fetcher'
import { normalizeGroupedTimetable } from 'utils/timetable-shim'
import { parseStationId } from 'utils/saved-stations'
import { useNetworkStatus } from '~/hooks/network'
import SavedStopCard from '../saved-stop-card'

// Matches routes/home.tsx: schedules are static for the day, so an hour of
// deduping is plenty and keeps the sheet cheap to reopen.
const swrConfig = {
  dedupingInterval: import.meta.env.DEV ? 0 : 60 * 60 * 1000,
  focusThrottleInterval: import.meta.env.DEV ? 0 : 60 * 60 * 1000,
  revalidateOnFocus: true,
  shouldRetryOnError: false
}

interface RowProps {
  stationId: string
  now: Date
  onSelectStation: (stationId: string) => void
}

function SavedStationRow({ stationId, now, onSelectStation }: RowProps) {
  const parsed = parseStationId(stationId)
  const operator = parsed?.operator ?? ''
  const code = parsed?.code ?? ''

  // Same SWR keys the station page and StationContent use, so pushing this
  // station onto the sheet stack costs no extra request.
  const station = useSWR<StandardResponse<Station>>(
    parsed ? new URL(`/stations/${operator}/${code}`, import.meta.env.VITE_API_BASE_URL).href : null,
    fetcher,
    swrConfig
  )
  const timetable = useSWR<StandardResponse<CompactLineGroupedTimetable>>(
    parsed ? new URL(`/stations/${operator}/${code}/timetable/grouped?compact=1`, import.meta.env.VITE_API_BASE_URL).href : null,
    fetcher,
    swrConfig
  )
  const timetableData = useMemo(
    () => normalizeGroupedTimetable(timetable.data?.data),
    [timetable.data]
  )
  const networkStatus = useNetworkStatus()

  if (!parsed) return null

  if (station.isLoading) {
    return (
      <li className="animate-pulse">
        <div className="h-24 w-full bg-slate-200 rounded-xl" />
      </li>
    )
  }

  // The station itself failed to load. Keep this a compact retry card rather
  // than a full empty state — this IS a saved station, and a page-sized error
  // would break the list.
  if (!station.data?.data) {
    return (
      <li>
        <article className="p-3 bg-rose-50 rounded-xl flex flex-col gap-2 items-start">
          <span className="font-semibold text-slate-700 text-sm">
            {networkStatus === 'OFFLINE'
              ? 'Tidak dapat memuat stasiun ini saat offline'
              : 'Gagal memuat stasiun ini'}
          </span>
          <button
            type="button"
            onClick={() => { void Promise.all([station.mutate(), timetable.mutate()]) }}
            className="bg-[#F55875] text-white font-bold px-3 py-1.5 rounded-lg cursor-pointer text-sm"
          >
            Coba Lagi
          </button>
        </article>
      </li>
    )
  }

  return (
    <SavedStopCard
      stationId={stationId}
      operator={station.data.data.operator.code}
      // formattedName is the display-styled name; not every station has one.
      formattedName={station.data.data.formattedName ?? station.data.data.name}
      lines={station.data.data.lines}
      timetable={timetableData}
      now={now}
      onSelect={onSelectStation}
    />
  )
}

interface Props {
  stationIds: string[]
  now: Date
  onSelectStation: (stationId: string) => void
}

export default function SavedStationList({ stationIds, now, onSelectStation }: Props) {
  if (stationIds.length === 0) {
    return (
      <div className="px-4 py-6 max-w-3xl mx-auto text-center" aria-live="polite">
        <p className="font-bold text-slate-900">Belum Ada Stasiun Disimpan</p>
        <p className="text-sm text-slate-600 mt-1">
          Klik tombol
          {' '}
          <b>Cari</b>
          {' '}
          di atas untuk mulai cari jadwal & simpan stasiun!
        </p>
      </div>
    )
  }

  return (
    <ul
      className="flex flex-col gap-3 px-4 py-3 pb-24 max-w-3xl mx-auto"
      aria-label="Daftar stasiun tersimpan"
    >
      {stationIds.map(stationId => (
        <SavedStationRow
          key={stationId}
          stationId={stationId}
          now={now}
          onSelectStation={onSelectStation}
        />
      ))}
    </ul>
  )
}
