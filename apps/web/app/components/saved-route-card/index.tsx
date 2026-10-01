import type { FareJourney, FareResult, FareResultRideLeg, TripResult } from '@commute/schemas'
import type { StandardResponse } from '@schema/response'
import { ArrowRightIcon, CaretRightIcon } from '@phosphor-icons/react'
import { useMemo } from 'react'
import { Link } from 'react-router'
import useSWR from 'swr'
import { fetcher } from 'utils/fetcher'
import { FARE_SWR_CONFIG, tripApiUrl } from 'utils/fare-api'
import { readFareCriteria } from 'utils/fare-criteria'
import { DEPARTURE_SLOT_MINUTES } from 'utils/departure-time'
import { getTintFromColor } from 'utils/colors'
import { formatClock, formatDuration, formatRupiah } from 'utils/format'
import { boardingClock, boardsAtOf, journeyKey } from 'utils/journey-key'
import LineRoundel from '~/components/line-roundel'
import { LINE_COLOR_FALLBACK } from '~/components/transit-geometry'
import { journeysOf } from '~/components/fare-sheet/journeys'
import { codeOfLineKey, useLines } from '~/hooks/use-lines'
import { useClock } from '~/hooks/clock'
import { useNetworkStatus } from '~/hooks/network'
import { resumeTimeOf, upcomingJourneys } from './upcoming'

const MAX_ROWS = 3

/*
 * Same key as /fare, so a pair checked there is already warm here. The
 * departure is always the clock's, never the rider's stored pick: home answers
 * "what leaves now". Revalidates once per departure slot, the grain the API
 * caches at, so the rows roll forward while the page stays open.
 */
const swrConfig = {
  ...FARE_SWR_CONFIG,
  dedupingInterval: 60 * 1000,
  focusThrottleInterval: 60 * 1000,
  revalidateOnFocus: true,
  refreshInterval: DEPARTURE_SLOT_MINUTES * 60 * 1000
}

function fareUrl(from: string, to: string, journey?: FareJourney) {
  const params = new URLSearchParams({ from, to })
  if (journey) {
    params.set('j', journeyKey(journey))
    // Rows of one route share a key; the clock says which train was tapped.
    const boardsAt = boardsAtOf(journey)
    if (boardsAt) params.set('jt', boardingClock(boardsAt))
  }
  return `/fare?${params.toString()}`
}

/*
 * "transit Nx" counts walk transfers only, by decision, so a same-platform
 * change (Bogor line into Cikarang at Manggarai) is transit 0x. That still
 * isn't "langsung": two roundels beside that word would contradict it.
 */
function changeLabel(journey: FareJourney): string {
  if (journey.transferCount > 0) return `transit ${journey.transferCount}x`
  return journey.boardings > 1 ? 'ganti kereta' : 'langsung'
}

function JourneyRow({ journey, from, to, tint }: { journey: FareJourney, from: string, to: string, tint: string }) {
  const { line: lookupLine } = useLines()
  const rides = journey.legs.filter((leg): leg is FareResultRideLeg => leg.type === 'RIDE')
  const boardsAt = boardsAtOf(journey)
  const duration = boardsAt && journey.arrivalAt ? formatDuration(boardsAt, journey.arrivalAt) : null
  const headsign = rides[0]?.headsign ?? null
  const lastTrain = rides.some(leg => leg.lastService)

  return (
    <li className="border-t first:border-t-0" style={{ borderTopColor: tint }}>
      <Link to={fareUrl(from, to, journey)} className="px-4 py-3 flex items-center gap-3">
        <span className="flex items-center gap-1 shrink-0">
          {rides.map((leg, index) => {
            const line = lookupLine(leg.line)
            return (
              <LineRoundel
                key={`${leg.line}-${index}`}
                size="SM"
                operator={leg.operator}
                code={codeOfLineKey(leg.line)}
                color={(line?.colorCode ?? LINE_COLOR_FALLBACK) as `#${string}`}
              />
            )
          })}
        </span>
        <span className="flex-grow min-w-0 flex flex-col">
          {boardsAt
            ? (
                <span className="figure text-lg font-bold tabular-nums leading-tight">
                  {formatClock(boardsAt)}
                  {journey.arrivalAt
                    ? (
                        <>
                          <span className="text-slate-400 font-semibold">{' → '}</span>
                          {formatClock(journey.arrivalAt)}
                        </>
                      )
                    : null}
                </span>
              )
            : (
                <span className="text-base font-bold leading-tight truncate">
                  {headsign ? `Arah ${headsign}` : 'Jadwal tidak tersedia'}
                </span>
              )}
          <span className="text-xs font-semibold text-slate-500 truncate">
            {lastTrain ? <span className="text-amber-700">Kereta terakhir · </span> : null}
            {changeLabel(journey)}
            {boardsAt && headsign ? ` · arah ${headsign}` : null}
          </span>
        </span>
        <span className="shrink-0 flex flex-col items-end">
          {duration ? <span className="figure text-sm font-bold tabular-nums">{duration}</span> : null}
          {journey.totalFare !== null
            ? <span className="figure text-xs font-semibold text-slate-500 tabular-nums">{formatRupiah(journey.totalFare)}</span>
            : null}
        </span>
      </Link>
    </li>
  )
}

/*
 * A saved Dari→Ke pair on home: the next few boardings and nothing else.
 *
 * Dressed like a LineCard (heavy top rule, tinted body) so the two read as one
 * list, with the colour taken from the line the soonest row boards on. Each row
 * opens /fare on that exact route via its `?j=` key.
 */
export default function SavedRouteCard({ from, to }: { from: string, to: string }) {
  const url = tripApiUrl(from, to, { ...readFareCriteria(), fareTime: 'now' })
  const trip = useSWR<StandardResponse<FareResult | TripResult>>(url, fetcher, swrConfig)
  const { line: lookupLine } = useLines()
  const now = useClock()
  const networkStatus = useNetworkStatus()

  const result = trip.data?.data
  const rows = useMemo(
    () => (result ? upcomingJourneys(journeysOf(result), now, MAX_ROWS) : []),
    [result, now]
  )
  const resumesAt = useMemo(() => (result ? resumeTimeOf(journeysOf(result)) : null), [result])
  // Coloured by the soonest row, or once the night is over by the route that
  // starts again, so an ended card keeps its line's colour instead of greying.
  const lead = rows[0] ?? (result ? journeysOf(result).find(journey => journey.resumesAt) : undefined)
  const firstRide = lead?.legs.find((leg): leg is FareResultRideLeg => leg.type === 'RIDE')
  const lineColor = (firstRide && lookupLine(firstRide.line)?.colorCode) ?? LINE_COLOR_FALLBACK
  const tint = getTintFromColor(lineColor, 0.3)

  if (trip.isLoading) {
    return (
      <article className="content-fade mx-4">
        <div className="animate-pulse">
          <div className="h-6 w-64 mt-4 mb-4 bg-slate-200 rounded" />
          <div className="lg:grid lg:grid-cols-2 gap-4">
            <div className="w-full h-[200px] bg-slate-200 rounded-xl" />
          </div>
        </div>
      </article>
    )
  }

  if (!result) {
    return (
      <article className="mx-4 mt-4 p-4 bg-rose-50 rounded-xl flex flex-col gap-3 items-start">
        <span className="font-semibold text-slate-700">
          {networkStatus === 'OFFLINE'
            ? 'Tidak dapat memuat rute ini saat offline'
            : 'Gagal memuat rute ini'}
        </span>
        <button
          type="button"
          onClick={() => { void trip.mutate() }}
          className="bg-[#F55875] text-white font-bold px-4 py-2 rounded-lg cursor-pointer"
        >
          Coba Lagi
        </button>
      </article>
    )
  }

  return (
    <article className="content-fade">
      <h1 className="font-bold text-xl flex px-4 py-4 sticky top-0 bg-rose-50/20 backdrop-blur-2xl z-10 lg:relative lg:backdrop-blur-none lg:bg-transparent">
        <Link to={fareUrl(from, to)} className="group flex-grow flex items-center gap-2 min-w-0" aria-label={`Rute ${result.from.name} ke ${result.to.name}`}>
          <span className="truncate">{result.from.name}</span>
          <ArrowRightIcon weight="bold" className="w-4 h-4 shrink-0" />
          <span className="truncate">{result.to.name}</span>
          <CaretRightIcon weight="bold" className="inline w-4 h-4 shrink-0 group-hover:ml-1 ml-0 transition-[margin] duration-200" />
        </Link>
      </h1>
      {/* The same two-column grid StationCard's LineCards sit in, so on
          desktop this card is one column wide like them rather than spanning
          both. */}
      <div className="mx-4 lg:grid lg:grid-cols-2 gap-4">
        <div
          className="rounded-xl shadow-lg border-t-[16px] overflow-hidden"
          style={{ borderTopColor: lineColor, backgroundColor: getTintFromColor(lineColor, 0.065) }}
        >
          {rows.length > 0
            ? (
                <ul aria-label={`Keberangkatan berikutnya dari ${result.from.name} ke ${result.to.name}`}>
                  {rows.map(journey => (
                    <JourneyRow key={`${journeyKey(journey)}@${boardsAtOf(journey) ?? ''}`} journey={journey} from={from} to={to} tint={tint} />
                  ))}
                </ul>
              )
            : (
                // Same words as a LineCard whose service is over, so the two
                // read alike in one list.
                <Link to={fareUrl(from, to)} className="px-4 py-3 flex flex-col">
                  <span className="text-lg font-bold leading-tight text-slate-500">Udahan</span>
                  <span className="text-xs font-semibold text-slate-500">
                    {resumesAt ? `mulai lagi ${formatClock(resumesAt)}` : 'Udah gak ada keberangkatan lagi'}
                  </span>
                </Link>
              )}
        </div>
      </div>
    </article>
  )
}
