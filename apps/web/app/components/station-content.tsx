import { memo, useMemo, type JSX } from 'react'
import { Link } from 'react-router'
import useSWR from 'swr'
import {
  ArrowSquareOutIcon,
  BabyIcon,
  BicycleIcon,
  NavigationArrowIcon,
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
import { AMENITY_TYPES, OPERATORS, type AmenityType } from '@commute/constants'
import type { StandardResponse } from '@schema/response'
import type { Station } from '@commute/schemas'
import type { CompactLineGroupedTimetable } from '@commute/schemas'
import type { Transfer } from '@commute/schemas'
import { directionalBaseName } from 'utils/directional-stations'
import LineCard from '~/components/line-card'
import LineRoundel from '~/components/line-roundel'
import EmptyState from '~/components/empty-state'
import { fetcher } from 'utils/fetcher'
import { normalizeGroupedTimetable } from 'utils/timetable-shim'
import { sortLinesForDisplay } from '~/utils/lines'
import { useNetworkStatus } from '~/hooks/network'
import { getUnservedStation } from '~/lib/unserved-stations'
import { useLines } from '~/hooks/use-lines'
import { buildFareDestinationPath } from 'utils/fare-url'
import PaneLink from '~/components/pane-stack/pane-link'

const swrConfig = {
  dedupingInterval: import.meta.env.DEV ? 0 : 60 * 60 * 1000,
  focusThrottleInterval: import.meta.env.DEV ? 0 : 60 * 60 * 1000,
  revalidateOnFocus: true,
  shouldRetryOnError: false
}

/**
 * In memoriam block for Stasiun Bekasi Timur.
 *
 * On 27 April 2026 at ~20.57 WIB a KRL Commuter Line (PLB 5568A) struck a car
 * on level crossing JPL 85; the Argo Bromo Anggrek following behind could not
 * stop in time and hit the stationary KRL. Sixteen people were killed and
 * around ninety injured. Basarnas confirmed every one of the dead was a woman.
 *
 * Hard-coded by request rather than modelled as station data: this is the only
 * such block in the app, and inventing a general "memorial" schema off one
 * event would be over-engineering. If a second one is ever needed, lift this
 * into a keyed record then — do not shoehorn it into `amenities`, which is a
 * facilities inventory and renders as a list of things a station offers.
 *
 * Deliberately restrained: no icon, no colour accent, no card chrome. The
 * house voice is casual commuter Indonesian; that is wrong here, so this copy
 * is plain and factual. Widely reported that the victims were in the
 * women-only car, but the Indonesian Wikipedia account does not confirm the
 * car placement, so it is not asserted — only that all sixteen were women.
 *
 * The phrasing "sedang dalam perjalanan menuju suatu tempat" is the author's
 * and is load-bearing: they were commuters mid-journey, like whoever is
 * reading this page. Do not edit it down to a casualty count.
 */
function BekasiTimurMemorial() {
  return (
    <section className="mt-8 border-t border-slate-200 pt-6">
      <h2 className="font-semibold text-lg px-4">In Memoriam</h2>
      <p className="mt-3 px-4 text-gray-700 leading-relaxed">
        27 April 2026. Enam belas perempuan yang sedang dalam perjalanan menuju
        suatu tempat kehilangan nyawanya di stasiun ini. Sekitar sembilan puluh
        orang lainnya terluka.
      </p>
      <p className="mt-3 px-4 text-gray-700 leading-relaxed">
        Kami mengenang mereka.
      </p>
    </section>
  )
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

interface StationContentProps {
  operator: string
  code: string
  // Map-only: "Petunjuk Arah" primes the map's pick-a-departure mode instead of
  // linking to /fare. Supplied by StationSheet; the full station page leaves it
  // unset. Must be referentially stable — it participates in the memo compare.
  onSelectDeparture?: () => void
}

export interface StationHeader {
  isLoading: boolean
  /** Display name, with any directional "Arah …" suffix stripped. */
  name: string | null
  stationId: string | null
  /** Operator-qualified line keys. */
  lines: string[]
  // The station exists (e.g. on the map) but no operator we cover serves it
  // yet, so there is no API record to fetch.
  unserved: boolean
}

interface UseStationDataResult {
  header: StationHeader
}

export function useStationHeader(operator: string, code: string): UseStationDataResult {
  const unserved = getUnservedStation(operator, code)
  const stationUrl = useMemo(() =>
    new URL(`/stations/${operator}/${code}`, import.meta.env.VITE_API_BASE_URL).href,
  [operator, code]
  )
  const station = useSWR<StandardResponse<Station>>(unserved ? null : stationUrl, fetcher, swrConfig)

  if (unserved) {
    return {
      header: {
        isLoading: false,
        name: unserved.formattedName,
        stationId: null,
        lines: [],
        unserved: true
      }
    }
  }

  const resolvedName = station.data?.data?.name ?? null

  return {
    header: {
      isLoading: station.isLoading,
      // Directional haltes ("… Arah Utara") are one stop to a rider; the sheet
      // shows the plain name, matching how search presents the joined pair.
      name: resolvedName === null ? null : directionalBaseName(resolvedName),
      stationId: station.data?.data?.id ?? null,
      lines: station.data?.data?.lines ?? [],
      unserved: false
    }
  }
}

const StationContent = memo(function StationContent({ operator, code, onSelectDeparture }: StationContentProps) {
  const unserved = getUnservedStation(operator, code)
  // Route params are not case-normalised anywhere, so fold case here rather
  // than let a lowercase URL silently drop the memorial.
  const isBekasiTimur = operator.toUpperCase() === 'KCI' && code.toUpperCase() === 'BKST'
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

  const station = useSWR<StandardResponse<Station>>(unserved ? null : stationUrl, fetcher, swrConfig)
  const timetable = useSWR<StandardResponse<CompactLineGroupedTimetable>>(unserved ? null : timetableUrl, fetcher, swrConfig)
  const timetableData = useMemo(() => normalizeGroupedTimetable(timetable.data?.data), [timetable.data])
  const transfers = useSWR<StandardResponse<Transfer[]>>(unserved ? null : transfersUrl, fetcher, swrConfig)
  // Line keys on stations and transfers resolve through the dictionary.
  const { lines: resolveLines } = useLines()
  const networkStatus = useNetworkStatus()

  if (unserved) {
    return (
      <div className="flex flex-col max-w-3xl mx-auto pb-8 px-4 mt-4">
        <EmptyState mode="NO_DATA" title={unserved.title} message={unserved.message} />
      </div>
    )
  }

  if (timetable.isLoading || station.isLoading) {
    return (
      <div className="px-4 pb-8 mt-2 flex flex-col gap-2 max-w-3xl mx-auto">
        <div className="animate-pulse w-full h-72 bg-slate-200 rounded-lg" />
      </div>
    )
  }

  return (
    <div className="flex flex-col max-w-3xl mx-auto pb-8 px-4 mt-4">
      {(() => {
        if (timetableData?.length) {
          return (
            <>
              {networkStatus === 'OFFLINE' && (
                <div className="text-amber-950 bg-amber-100 flex flex-row gap-2 rounded-xl p-4 font-semibold mb-4">
                  <WarningIcon weight="duotone" className="w-6 h-6" />
                  Kamu sedang offline, data mungkin tidak up-to-date
                </div>
              )}
              <div className="flex flex-row gap-2">
                {(() => {
                  // In the map sheet the button primes departure picking on the
                  // map; on the full page it deep-links to /fare with this
                  // station as the destination. Built from the API id, not the
                  // route params — params are not case-normalised (see the
                  // Bekasi Timur fold above) and the id is canonical.
                  const buttonClass = 'flex flex-row gap-2 justify-center bg-[#F55875] text-white font-bold p-4 rounded-xl text-center w-full text-sm cursor-pointer'
                  if (onSelectDeparture) {
                    return (
                      <button type="button" onClick={onSelectDeparture} className={buttonClass}>
                        <NavigationArrowIcon className="w-5 h-5" weight="bold" mirrored aria-hidden />
                        OTW Ke Sini
                      </button>
                    )
                  }
                  const farePath = buildFareDestinationPath(station.data?.data?.id)
                  if (!farePath) return null
                  return (
                    <Link to={farePath} className={buttonClass}>
                      <NavigationArrowIcon className="w-5 h-5" weight="bold" mirrored aria-hidden />
                      OTW Ke Sini
                    </Link>
                  )
                })()}
                <PaneLink
                  pane={{ kind: 'timetable', operator, code }}
                  className="flex flex-row gap-2 justify-center bg-slate-200 text-[#F55875] font-bold p-4 rounded-xl text-center w-full text-sm"
                >
                  Jadwal Lengkap
                </PaneLink>
              </div>
              <ul className="flex flex-col gap-2 mt-4">
                {timetableData.map(line => (
                  <LineCard key={line.line} line={line} operator={operator} />
                ))}
              </ul>
            </>
          )
        }

        if (networkStatus === 'OFFLINE') return <EmptyState mode="OFFLINE" onRetry={() => timetable.mutate()} />
        // TransJakarta publishes no timetable — surface the boarding-board hint,
        // not a load error.
        if (operator === 'TJ') return <EmptyState mode="NO_SCHEDULE" />
        if (timetable.error) return <EmptyState mode="ERROR" onRetry={() => timetable.mutate()} />
        return <EmptyState mode="NO_DATA" />
      })()}
      {isBekasiTimur && <BekasiTimurMemorial />}
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
      {/* Outside the timetable branch on purpose: TJ stops have no timetable
          but still deserve a way to the physical halte. */}
      {station.data?.data?.latitude && station.data.data.longitude
        ? (
            <section className="mt-8">
              <a
                href={`https://maps.google.com/maps?q=${station.data.data.latitude},${station.data.data.longitude}(${encodeURIComponent(station.data.data.name)})`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex flex-row gap-2 justify-center bg-slate-200 text-[#F55875] font-bold p-4 rounded-xl text-center w-full text-sm"
              >
                Buka di Google Maps
                <ArrowSquareOutIcon className="w-5 h-5" weight="bold" aria-label="Link eksternal, akan membuka Google Maps" />
              </a>
            </section>
          )
        : null}
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
                          {transfer.distanceM}
                          m
                        </span>
                      </span>
                      <span className="font-semibold text-gray-600 flex items-center">
                        {/* INTERNAL transfers carry an operator code; EXTERNAL ones
                            only a free-text operator name. */}
                        {transfer.dataType === 'INTERNAL'
                          ? OPERATORS[transfer.toStation.operator]?.name ?? transfer.toStation.operator
                          : transfer.toStation.operatorName}
                      </span>
                      {transfer.dataType === 'INTERNAL' && (() => {
                        const transferOperator = transfer.toStation.operator
                        // TJ has no line-detail (topology) pages yet, so render its
                        // roundels non-clickable rather than linking to a 404.
                        const linkable = transferOperator !== 'TJ'
                        return (
                          <ul className="flex gap-2 items-center">
                            {sortLinesForDisplay(resolveLines(transfer.toStation.lines), transferOperator).map(line => (
                              <li key={line.lineCode}>
                                {linkable
                                  ? (
                                      <Link
                                        to={`/lines/${transferOperator}/${line.lineCode}`}
                                        className="block"
                                        aria-label={`Lihat rute ${line.name}`}
                                      >
                                        <LineRoundel size="SM" code={line.lineCode} color={line.colorCode} operator={transferOperator} />
                                      </Link>
                                    )
                                  : (
                                      <>
                                        <LineRoundel size="SM" code={line.lineCode} color={line.colorCode} operator={transferOperator} />
                                        <span className="sr-only">{line.name}</span>
                                      </>
                                    )}
                              </li>
                            ))}
                          </ul>
                        )
                      })()}
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
})

// Memoized: the parent (StationSheet) re-renders on every snap change, but
// this subtree only depends on operator + code. Without memo, each re-render
// reconciles the whole timetable/amenity tree (~67ms) and freezes the sheet
// at the release position for several frames before the snap animation can
// start.
export default StationContent
