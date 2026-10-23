import type { FareJourney, FareResult, FareResultRideLeg, TripResult } from '@commute/schemas'
import type { StandardResponse } from '@schema/response'
import { ArrowRightIcon, CaretRightIcon } from '@phosphor-icons/react'
import clsx from 'clsx'
import { useMemo } from 'react'
import { Link } from 'react-router'
import useSWR from 'swr'
import { fetcher } from 'utils/fetcher'
import { FARE_SWR_CONFIG, tripApiUrl } from 'utils/fare-api'
import { readFareCriteria } from 'utils/fare-criteria'
import { DEPARTURE_SLOT_MINUTES } from 'utils/departure-time'
import { getTintFromColor } from 'utils/colors'
import { formatClock, formatDuration, formatRupiah } from 'utils/format'
import { boardingClock, journeyKey } from 'utils/journey-key'
import LineRoundel from '~/components/line-roundel'
import { LINE_COLOR_FALLBACK } from '~/components/transit-geometry'
import { estimatedDurationOf, journeysOf } from '~/components/fare-sheet/journeys'
import { WalkChip } from '~/components/fare-sheet/route-bar'
import { routeBarSegments } from '~/components/fare-sheet/route-bar-segments'
import { codeOfLineKey, useLines } from '~/hooks/use-lines'
import { useClock } from '~/hooks/clock'
import { useNetworkStatus } from '~/hooks/network'
import { resumeTimeOf, upcomingJourneys, type UpcomingRow } from './upcoming'

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

function fareUrl(from: string, to: string, journey?: FareJourney, boardsAt?: string) {
  const params = new URLSearchParams({ from, to })
  if (journey) {
    params.set('j', journeyKey(journey))
    // The train the row leads with, which may be later than the route's own
    // once that one has left. /fare falls back to the route when it differs.
    if (boardsAt) params.set('jt', boardingClock(boardsAt))
  }
  return `/fare?${params.toString()}`
}

/*
 * How many of a route's later trains a row names after the one it leads with.
 * Two, like the reference apps: enough to see whether missing this one costs
 * five minutes or twenty, without the row turning into a timetable.
 */
const NEXT_SHOWN = 2

function JourneyRow({ row: { journey, departures }, from, to, tint }: { row: UpcomingRow, from: string, to: string, tint: string }) {
  const { line: lookupLine } = useLines()
  const rides = journey.legs.filter((leg): leg is FareResultRideLeg => leg.type === 'RIDE')
  const segments = routeBarSegments(journey.legs, (leg) => {
    const code = codeOfLineKey(leg.line)
    const line = lookupLine(leg.line)
    return [{ code, name: line?.name ?? code, color: line?.colorCode ?? LINE_COLOR_FALLBACK }]
  })
  /*
   * The soonest train still to come, which is the route's own unless that one
   * has left while the body was held — then the next one riding along with it,
   * with that train's own arrival.
   */
  const lead = departures[0]
  const boardsAt = lead?.departureAt ?? null
  const arrivalAt = lead?.arrivalAt
  // Published, or else the ±-marked TransJakarta estimate counted the same way.
  const duration = boardsAt && arrivalAt ? formatDuration(boardsAt, arrivalAt) : estimatedDurationOf(journey)
  const next = departures.slice(1, 1 + NEXT_SHOWN)
  const headsign = rides[0]?.headsign ?? null
  const lastTrain = rides.some(leg => leg.lastService)

  /*
   * The figures on the right sit on the line they belong to rather than
   * centred on the row: the duration beside the clock it is measured from, the
   * fare beneath it. A row with neither a published nor an estimated duration
   * has nothing for that slot, so the fare moves up to
   * the headline's line instead of floating beside an empty one.
   */
  const fare = journey.totalFare !== null ? formatRupiah(journey.totalFare) : null
  const headlineFigure = duration ?? fare
  const secondFigure = duration ? fare : null
  /*
   * Last train and later trains never meet — the last has nothing after it —
   * so they share one line. The last train wins it, because it changes what a
   * rider does. No change count or headsign: the roundels already say how many
   * vehicles and which lines, and the row is about when.
   */
  const nextLine = next.length > 0
    ? (
        <span className="figure text-xs font-semibold text-slate-500 tabular-nums truncate">
          {`berikutnya ${next.map(departure => formatClock(departure.departureAt)).join(', ')}`}
        </span>
      )
    : null
  const secondLine = lastTrain
    ? <span className="text-xs font-semibold text-amber-700 truncate">Kereta terakhir</span>
    : nextLine

  return (
    <li className="border-t first:border-t-0" style={{ borderTopColor: tint }}>
      <Link to={fareUrl(from, to, journey, boardsAt ?? undefined)} className="px-4 py-3 flex flex-col">
        {/*
          * The lines ride above the clock rather than beside it: beside, a
          * three-leg row pushed the times inward and every row started at a
          * different x, so the clocks no longer lined up down the card.
          */}
        {/*
          * Built by the route bar's own segmenter, so a walk between two rides
          * gets the same chip there and here — two roundels side by side hid
          * that the change is a 300 m walk. A change made on one platform has
          * no transfer leg and so no chip, and a walk before the first ride or
          * after the last is dropped, as the bar drops it.
          */}
        <span className="flex items-center gap-1 mb-1">
          {segments.map((segment, index) => segment.kind === 'WALK'
            ? <WalkChip key={index} distanceM={segment.distanceM} />
            : (
                <LineRoundel
                  key={index}
                  size="SM"
                  operator={segment.operator}
                  code={segment.code}
                  color={segment.colors[0] as `#${string}`}
                />
              ))}
        </span>
        <span className="flex items-baseline justify-between gap-3">
          {boardsAt
            ? (
                <span className="figure text-lg font-bold tabular-nums leading-tight inline-flex items-center gap-1.5">
                  {formatClock(boardsAt)}
                  {arrivalAt
                    ? (
                        <>
                          {/* An icon rather than a "→" glyph, which sits on the
                            * font's own baseline and read low beside the digits. */}
                          <ArrowRightIcon weight="bold" className="w-3.5 h-3.5 text-slate-400 shrink-0" aria-label="sampai" />
                          {formatClock(arrivalAt)}
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
          {headlineFigure
            ? (
                <span className={clsx('figure shrink-0 tabular-nums', duration ? 'text-sm font-bold' : 'text-xs font-semibold text-slate-500')}>
                  {headlineFigure}
                </span>
              )
            : null}
        </span>
        {secondLine || secondFigure
          ? (
              <span className="flex items-baseline justify-between gap-3">
                {secondLine ?? <span />}
                {secondFigure
                  ? <span className="figure shrink-0 text-xs font-semibold text-slate-500 tabular-nums">{secondFigure}</span>
                  : null}
              </span>
            )
          : null}
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
  const lead = rows[0]?.journey ?? (result ? journeysOf(result).find(journey => journey.resumesAt) : undefined)
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
                  {rows.map(row => (
                    <JourneyRow key={`${journeyKey(row.journey)}@${row.departures[0]?.departureAt ?? ''}`} row={row} from={from} to={to} tint={tint} />
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
