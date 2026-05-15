import { useMemo, type JSX } from 'react'
import { Link } from 'react-router'
import useSWR from 'swr'
import {
  ArrowSquareOutIcon,
  BabyIcon,
  BicycleIcon,
  BroadcastIcon,
  ElevatorIcon,
  EscalatorDownIcon,
  EscalatorUpIcon,
  LetterCirclePIcon,
  LockersIcon,
  PersonSimpleWalkIcon,
  PlugIcon,
  StarAndCrescentIcon,
  ToiletIcon,
  WarningIcon,
  WheelchairIcon
} from '@phosphor-icons/react'
import { AMENITY_TYPES, type AmenityType } from '@commute/constants'
import type { StandardResponse } from '@schema/response'
import type { Station } from 'models/stations'
import type { LineGroupedTimetable } from 'models/schedules'
import type { Transfer } from 'models/transfers'
import LineCard from '~/components/line-card'
import { fetcher } from 'utils/fetcher'
import { useNetworkStatus } from '~/hooks/network'
import { getForegroundColor } from 'utils/colors'

const swrConfig = {
  dedupingInterval: import.meta.env.DEV ? 0 : 60 * 60 * 1000,
  focusThrottleInterval: import.meta.env.DEV ? 0 : 60 * 60 * 1000,
  revalidateOnFocus: true,
  shouldRetryOnError: false
}

const AMENITY_ICONS: Record<AmenityType, JSX.Element> = {
  TOILET: <ToiletIcon weight="duotone" className="w-6 h-6" />,
  TOILET_ACCESSIBLE: (
    <div className="w-6 h-6 relative">
      <ToiletIcon weight="duotone" className="w-6 h-6" />
      <WheelchairIcon weight="bold" className="w-4 h-4 absolute -bottom-0.5 -right-0.5 bg-blue-500 text-white p-[1px] rounded-full" />
    </div>
  ),
  CHARGING_STATION: <PlugIcon weight="duotone" className="w-6 h-6" />,
  ESCALATOR_UNPAID: <EscalatorUpIcon weight="duotone" className="w-6 h-6" />,
  ESCALATOR_PAID: <EscalatorDownIcon weight="duotone" className="w-6 h-6" />,
  ELEVATOR_UNPAID: <ElevatorIcon weight="duotone" className="w-6 h-6" />,
  ELEVATOR_PAID: <ElevatorIcon weight="duotone" className="w-6 h-6" />,
  PRAYING_ROOM: <StarAndCrescentIcon weight="duotone" className="w-6 h-6 text-green-700" />,
  PARKING: <LetterCirclePIcon weight="duotone" className="w-6 h-6 text-blue-500" />,
  WIFI: <BroadcastIcon weight="duotone" className="w-6 h-6" />,
  BIKE_PARKING: <BicycleIcon weight="duotone" className="w-6 h-6" />,
  LOCKERS: <LockersIcon weight="duotone" className="w-6 h-6" />,
  NURSING_ROOM: <BabyIcon weight="duotone" className="w-6 h-6" />
}

function EmptyState({ mode = 'NO_DATA' }: { mode: 'OFFLINE' | 'NO_DATA' }) {
  const title = mode === 'OFFLINE' ? 'Jaringan Tidak Tersedia' : 'Jadwal Tidak Tersedia'
  const message = mode === 'OFFLINE'
    ? 'Silakan coba lagi beberapa saat lagi saat jaringan Anda tersambung'
    : 'Silakan coba lagi beberapa saat lagi'

  return (
    <div className="w-full h-auto flex items-center justify-center mt-8 flex-col max-w-3xl mx-auto">
      <picture>
        <source srcSet="/img/search_empty.webp" type="image/webp" />
        <img src="/img/search_empty.png" alt="Gambar peron stasiun dengan jembatan di atasnya, dengan kaca pembesar bergambar tanda tanya di depannya" className="w-48 h-48 aspect-square object-contain" />
      </picture>
      <span className="text-2xl text-center font-bold mt-0">{title}</span>
      <p className="text-center mt-2">
        {message}
      </p>
    </div>
  )
}

interface StationContentProps {
  operator: string
  code: string
}

export interface StationHeader {
  isLoading: boolean
  formattedName: string | null
  stationId: string | null
}

interface UseStationDataResult {
  header: StationHeader
}

export function useStationHeader(operator: string, code: string): UseStationDataResult {
  const stationUrl = useMemo(() =>
    new URL(`/stations/${operator}/${code}`, import.meta.env.VITE_API_BASE_URL).href,
  [operator, code]
  )
  const station = useSWR<StandardResponse<Station>>(stationUrl, fetcher, swrConfig)
  return {
    header: {
      isLoading: station.isLoading,
      formattedName: station.data?.data?.formattedName ?? null,
      stationId: station.data?.data?.id ?? null
    }
  }
}

export default function StationContent({ operator, code }: StationContentProps) {
  const stationUrl = useMemo(() =>
    new URL(`/stations/${operator}/${code}`, import.meta.env.VITE_API_BASE_URL).href,
  [operator, code]
  )
  const timetableUrl = useMemo(() =>
    new URL(`/stations/${operator}/${code}/timetable/grouped?compact=1`, import.meta.env.VITE_API_BASE_URL).href,
  [operator, code]
  )
  const transfersUrl = useMemo(() =>
    new URL(`/stations/${operator}/${code}/transfers`, import.meta.env.VITE_API_BASE_URL).href,
  [operator, code]
  )

  const station = useSWR<StandardResponse<Station>>(stationUrl, fetcher, swrConfig)
  const timetable = useSWR<StandardResponse<LineGroupedTimetable>>(timetableUrl, fetcher, swrConfig)
  const transfers = useSWR<StandardResponse<Transfer[]>>(transfersUrl, fetcher, swrConfig)
  const networkStatus = useNetworkStatus()

  if (timetable.isLoading) {
    return (
      <div className="px-4 pb-8 mt-2 flex flex-col gap-2 max-w-3xl mx-auto">
        <div className="animate-pulse w-full h-72 bg-slate-200 rounded-lg" />
      </div>
    )
  }

  return (
    <div className="flex flex-col max-w-3xl mx-auto pb-8 px-4 mt-4">
      {(() => {
        if (timetable.data?.data?.length) {
          return (
            <>
              {networkStatus === 'OFFLINE' && (
                <div className="text-amber-950 bg-amber-100 flex flex-row gap-2 rounded-xl p-4 font-semibold mb-4">
                  <WarningIcon weight="duotone" className="w-6 h-6" />
                  Kamu sedang offline, data mungkin tidak up-to-date
                </div>
              )}
              <div className="flex flex-row gap-2">
                {station.data?.data?.latitude && station.data.data.longitude
                  ? (
                      <a
                        href={`https://maps.google.com/maps?q=${station.data.data.latitude},${station.data.data.longitude}(${encodeURIComponent(station.data.data.formattedName || station.data.data.name)})`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex flex-row gap-2 justify-center bg-[#F55875] text-white font-bold p-4 rounded-xl text-center w-full text-sm"
                      >
                        Petunjuk Arah
                        <ArrowSquareOutIcon className="w-5 h-5" weight="bold" aria-label="Link eksternal, akan membuka Google Maps" />
                      </a>
                    )
                  : null}
                <Link
                  to={`/stations/${operator}/${code}/timetable`}
                  className="flex flex-row gap-2 justify-center bg-slate-200 text-[#F55875] font-bold p-4 rounded-xl text-center w-full text-sm"
                >
                  Jadwal Lengkap
                </Link>
              </div>
              <ul className="flex flex-col gap-2 mt-4">
                {timetable.data.data.map(line => (
                  <LineCard key={line.lineCode} line={line} />
                ))}
              </ul>
            </>
          )
        }

        if (networkStatus === 'OFFLINE') return <EmptyState mode="OFFLINE" />
        if (timetable.error) return <EmptyState mode="NO_DATA" />
        return <EmptyState mode="NO_DATA" />
      })()}
      <section className="mt-8">
        <h2 className="font-semibold text-lg px-4">Fasilitas</h2>
        {station.data?.data?.amenities?.length
          ? (
              <ul className="flex flex-col gap-2 mt-4">
                {station.data.data.amenities.map(amenity => (
                  <li key={amenity.type} className="flex items-center px-4 py-2 gap-2">
                    <span className="font-bold gap-2 flex flex-row items-center">
                      {AMENITY_ICONS[amenity.type]}
                      {AMENITY_TYPES[amenity.type]}
                    </span>
                    <span className="ml-auto text-gray-600">{amenity.text || 'Tersedia'}</span>
                  </li>
                ))}
              </ul>
            )
          : (
              <p className="mt-4 px-4 text-gray-600">Tidak ada data fasilitas untuk stasiun ini</p>
            )}
      </section>
      {transfers.data?.data?.length
        ? (
            <section className="mt-8">
              <h2 className="font-semibold text-lg px-4">Integrasi</h2>
              <ul className="flex flex-col gap-4 mt-4">
                {transfers.data.data.map(transfer => (
                  <li key={transfer.id} className="flex flex-col px-4">
                    <div className="flex flex-col">
                      <span className="font-semibold flex items-center">
                        {transfer.toStation.name}
                        <span className="text-gray-600 flex flex-row items-center ml-2">
                          <PersonSimpleWalkIcon weight="bold" className="w-4 h-4" aria-label="Jarak transit" />
                          &nbsp;
                          {transfer.distance}
                          m
                        </span>
                      </span>
                      <span className="font-semibold text-gray-600 flex items-center">
                        {transfer.toStation.operatorName}
                      </span>
                      {transfer.dataType === 'INTERNAL' && (
                        <ul className="flex gap-2 items-center">
                          {transfer.toStation.lines.map(line => (
                            <li
                              key={line.lineCode}
                              className={`text-sm font-semibold px-2.5 py-0.5 rounded-full text-stone-800 ${getForegroundColor(line.colorCode) === 'LIGHT' ? 'text-white' : 'text-slate-900'}`}
                              style={{ backgroundColor: line.colorCode }}
                            >
                              {line.name.replace(/Lin /g, '')}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                    {transfer.notes
                      ? (
                          <p className="text-gray-600 mt-1">{transfer.notes}</p>
                        )
                      : null}
                  </li>
                ))}
              </ul>
            </section>
          )
        : null}
    </div>
  )
}
