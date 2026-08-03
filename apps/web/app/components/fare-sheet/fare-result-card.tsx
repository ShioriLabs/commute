import type { FareJourney, FareResult, FareResultLeg, FareResultRideLeg, FareResultTransferLeg, TripResult } from '@commute/schemas'
import { OPERATORS, type Operator } from '@commute/constants'
import { useEffect, useState } from 'react'
import { ArrowsDownUpIcon, CaretDownIcon, CaretRightIcon, PersonSimpleWalkIcon, TicketIcon } from '@phosphor-icons/react'
import { getForegroundColor } from 'utils/colors'
import { joinLabels } from 'utils/labels'
import LineRoundel from '~/components/line-roundel'
import { codeOfLineKey, useLines } from '~/hooks/use-lines'
import { JOURNEY_LABELS } from './journey-labels'
import { journeysOf, sortJourneyLabels, walkDistanceOf } from './journeys'

const rupiah = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 })
const formatKm = (distanceM: number) => `${(distanceM / 1000).toLocaleString('id-ID', { maximumFractionDigits: 1 })} km`
const operatorName = (code: string) => (OPERATORS as Record<string, { name: string }>)[code as Operator]?.name ?? code

/*
 * At-a-glance segment fill: a gradient across the service colours for interlined
 * legs (shared track), otherwise the single line colour. Colours are resolved
 * from the line dictionary, since legs carry keys rather than colours.
 */
function rideGlanceStyle(leg: FareResultRideLeg, colors: string[]) {
  const first = colors[0] ?? '#888888'
  if (colors.length > 1) {
    return { flexGrow: leg.distanceM, backgroundImage: `linear-gradient(to right, ${first}, ${colors[colors.length - 1]})` }
  }
  return { flexGrow: leg.distanceM, backgroundColor: first }
}

// One ride leg: board node, line-colored connector carrying the service card
// (line pill, headsign, expandable intermediate stops), alight node.
function RideLeg({ leg, isSameStationTransfer }: { leg: FareResultRideLeg, isSameStationTransfer: boolean }) {
  const [expanded, setExpanded] = useState(false)
  const { line: lookupLine } = useLines()
  // Optional-chained against a stale API during deploy skew.
  const intermediate = leg.stops?.slice(1, -1) ?? []
  const summary = `${leg.stationCount - 1} stasiun • ${formatKm(leg.distanceM)}`
  /*
   * On interlined track (the LRT Jabodebek trunk) several service lines run the
   * same leg — any train works. Fall back to the leg's own line otherwise.
   * Each carries a key; name and colour come from the dictionary.
   */
  const lines = (leg.serviceLines ?? [{ line: leg.line, headsign: leg.headsign }]).map(ref => ({
    key: ref.line,
    lineCode: codeOfLineKey(ref.line),
    lineName: lookupLine(ref.line)?.name ?? codeOfLineKey(ref.line),
    lineColor: lookupLine(ref.line)?.colorCode ?? '#888888',
    headsign: ref.headsign
  }))
  const isInterlined = lines.length > 1
  const legColor = lines[0]?.lineColor ?? '#888888'
  const directions = [...new Set(lines.map(line => line.headsign).filter((headsign): headsign is string => headsign !== null))]
  const railStyle = isInterlined
    ? { backgroundImage: `repeating-linear-gradient(to bottom, ${lines[0]!.lineColor} 0 8px, ${lines[lines.length - 1]!.lineColor} 8px 16px)` }
    : { backgroundColor: legColor }

  return (
    <li className="flex flex-col">
      {isSameStationTransfer
        ? (
            <div className="flex items-stretch gap-3">
              <span className="w-4 flex justify-center shrink-0">
                <span className="w-1.5 rounded-full bg-slate-300" />
              </span>
              <div className="flex items-center gap-1.5 text-sm text-slate-500 py-1.5">
                <ArrowsDownUpIcon weight="bold" className="w-3.5 h-3.5" />
                <span>{leg.operator === OPERATORS.TJ.code ? 'Pindah bus' : 'Pindah kereta'}</span>
              </div>
            </div>
          )
        : null}
      <div className="flex items-center gap-3">
        <span className="w-4 h-4 rounded-full border-[5px] bg-white shrink-0" style={{ borderColor: legColor }} />
        <b className="text-lg">{leg.from.name}</b>
      </div>
      <div className="flex items-stretch gap-3">
        <span className="w-4 flex justify-center shrink-0">
          <span className="w-1.5 rounded-full" style={railStyle} />
        </span>
        <div className="flex-1 my-2 bg-stone-100/80 rounded-xl p-3 flex flex-col gap-1 items-start">
          <div className="flex flex-wrap gap-1.5 items-center">
            {lines.map(line => (leg.operator === OPERATORS.TJ.code
              // TJ is spoken as "naik koridor 9", not by the line's full name —
              // show the corridor roundel instead of a name pill.
              ? (
                  <LineRoundel key={line.lineCode} size="SM" operator={leg.operator} code={line.lineCode} color={line.lineColor as `#${string}`} />
                )
              : (
                  <span
                    key={line.lineCode}
                    className={`text-sm font-semibold px-3 py-1 rounded-full w-fit ${getForegroundColor(line.lineColor) === 'LIGHT' ? 'text-white' : 'text-slate-900'}`}
                    style={{ backgroundColor: line.lineColor }}
                  >
                    { line.lineName }
                  </span>
                )))}
          </div>
          {isInterlined
            ? <span className="text-sm font-medium text-slate-600">{leg.operator === OPERATORS.TJ.code ? 'Naik salah satu bus' : 'Naik salah satu kereta'}</span>
            : null}
          {directions.length > 0
            ? (
                <span className="text-sm font-medium text-slate-600">
                  arah
                  {' '}
                  { joinLabels(directions) }
                </span>
              )
            : null}
          {intermediate.length === 0
            ? <span className="text-sm text-slate-500">{ summary }</span>
            : (
                <>
                  <button
                    type="button"
                    onClick={() => setExpanded(value => !value)}
                    aria-expanded={expanded}
                    className="flex items-center gap-1 text-sm text-slate-500 cursor-pointer"
                  >
                    { summary }
                    <CaretDownIcon weight="bold" className={`w-3.5 h-3.5 transition-transform ${expanded ? 'rotate-180' : ''}`} />
                  </button>
                  <div className={`grid transition-[grid-template-rows] duration-300 ${expanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'} w-full`}>
                    <ul className="overflow-hidden min-h-0 flex flex-col">
                      {intermediate.map(stop => (
                        <li key={stop.id} className="flex items-center gap-2 py-1 text-sm text-slate-600">
                          <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: legColor }} />
                          { stop.name }
                        </li>
                      ))}
                    </ul>
                  </div>
                </>
              )}
        </div>
      </div>
      <div className="flex items-center gap-3">
        <span className="w-4 h-4 rounded-full border-[5px] bg-white shrink-0" style={{ borderColor: legColor }} />
        <b className="text-lg">{leg.to.name}</b>
      </div>
    </li>
  )
}

// Itinerary timeline: ringed nodes at board/alight stations, line-colored
// connectors carrying the service card, walks as full-width cards that break
// the rail (TfL Go-style).
function JourneyTimeline({ legs }: { legs: FareResultLeg[] }) {
  return (
    <ol className="mt-6 flex flex-col">
      {legs.map((leg, index) => {
        // Two consecutive rides through the same station = same-station
        // interchange (no walk leg): bridge the islands with a grey rail.
        const previous = index > 0 ? legs[index - 1] : null
        const isSameStationTransfer = leg.type === 'RIDE'
          && previous?.type === 'RIDE'
          && previous.to.id === leg.from.id

        if (leg.type === 'RIDE') {
          return <RideLeg key={index} leg={leg} isSameStationTransfer={isSameStationTransfer} />
        }

        // Paid corridor (e.g. Dukuh Atas via KCI Sudirman): a transfer that
        // crosses a paid area, so it reads as a ticketed step, not a free walk.
        if (leg.corridorLabel != null && leg.fare != null) {
          return (
            <li key={index} className="flex items-stretch gap-3 my-2">
              <span className="w-4 flex justify-center shrink-0">
                <span className="w-1.5 rounded-full bg-rose-300" />
              </span>
              <div className="flex items-start gap-1.5 text-sm py-1.5">
                <TicketIcon weight="fill" className="w-3.5 h-3.5 shrink-0 mt-0.5 text-rose-500" />
                <div className="flex flex-col">
                  <span className="text-rose-700">
                    {leg.corridorLabel}
                    {' • '}
                    <b>{rupiah.format(leg.fare)}</b>
                  </span>
                  {leg.distanceM > 0 && (
                    <span className="text-slate-500">
                      Jalan kaki ±
                      {leg.distanceM}
                      m
                    </span>
                  )}
                </div>
              </div>
            </li>
          )
        }

        return (
          <li key={index} className="flex items-stretch gap-3 my-2">
            <span className="w-4 flex justify-center shrink-0">
              <span className="w-1.5 rounded-full bg-slate-300" />
            </span>
            <div className="flex items-center gap-1.5 text-sm text-slate-500 py-1.5">
              <PersonSimpleWalkIcon weight="bold" className="w-3.5 h-3.5" />
              <span>
                Transit ke
                {' '}
                {leg.to.name}
                {leg.distanceM > 0 && ` (Jalan kaki ±${leg.distanceM}m)`}
              </span>
            </div>
          </li>
        )
      })}
    </ol>
  )
}

// Service colours for the glance strip, resolved from the line dictionary.
function useLegColors() {
  const { line: lookupLine } = useLines()
  return (leg: FareResultRideLeg) =>
    (leg.serviceLines ?? [{ line: leg.line, headsign: null }])
      .map(ref => lookupLine(ref.line)?.colorCode ?? '#888888')
}

/*
 * The face of one option: fare, what it wins, and the shape of the trip.
 *
 * Presented as a button only when there is something to choose between. A lone
 * journey renders the identical block inert, because a press affordance on the
 * only answer invites a rider to look for an alternative that does not exist.
 */
function JourneyCardFace({ journey, selected, onSelect }: {
  journey: FareJourney
  selected: boolean
  onSelect?: () => void
}) {
  const legColors = useLegColors()
  const labels = sortJourneyLabels(journey.labels)
  const walkM = walkDistanceOf(journey)

  const body = (
    <>
      {labels.length > 0
        ? (
            <div className="flex flex-wrap gap-1.5">
              {labels.map(label => (
                <span key={label} className="text-xs font-bold px-2.5 py-1 rounded-full bg-rose-100 text-rose-900">
                  { JOURNEY_LABELS[label] }
                </span>
              ))}
            </div>
          )
        : null}
      <span className="text-3xl font-bold">
        {journey.totalFare !== null ? rupiah.format(journey.totalFare) : 'Tarif tidak tersedia'}
      </span>
      {/* Journey at a glance: ride legs proportional to distance, walks as dots. */}
      <div className="my-1 flex h-2 gap-0.5" aria-hidden="true">
        {journey.legs.map((leg, index) => leg.type === 'RIDE'
          ? <span key={index} className="rounded-full min-w-2" style={rideGlanceStyle(leg, legColors(leg))} />
          : <span key={index} className="w-1.5 shrink-0 rounded-full bg-slate-300" />)}
      </div>
      <span className="text-sm text-slate-500">
        {formatKm(journey.totalDistanceM)}
        {journey.transferCount > 0 ? ` • ${journey.transferCount}x transit` : ''}
        {/* Omitted, not zeroed, when the response could not say — see journeys.ts. */}
        {walkM !== null && walkM > 0 ? ` • jalan ${walkM} m` : ''}
      </span>
    </>
  )

  if (!onSelect) {
    return <div className="bg-rose-50 rounded-xl p-6 flex flex-col gap-1">{ body }</div>
  }

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-expanded={selected}
      className={`w-full text-left rounded-xl p-6 flex flex-col gap-1 cursor-pointer transition-colors ${
        selected ? 'bg-rose-50 border-2 border-rose-200' : 'bg-stone-100/80 border-2 border-transparent'
      }`}
    >
      { body }
    </button>
  )
}

/** The chosen option in full: itinerary, fare breakdown, disclaimer. */
function JourneyDetail({ journey }: { journey: FareJourney }) {
  // Surcharged transfers (e.g. the Dukuh Atas corridor) aren't ride segments but
  // do contribute to totalFare, so they need their own breakdown rows for the
  // line items to reconcile with the total.
  const surchargedTransfers = journey.legs.filter(
    (leg): leg is FareResultTransferLeg & { fare: number, corridorLabel: string } =>
      leg.type === 'TRANSFER' && leg.fare != null && leg.corridorLabel != null
  )

  return (
    <>
      <JourneyTimeline legs={journey.legs} />

      {journey.segments.length + surchargedTransfers.length > 1
        ? (
            <div className="mt-2">
              <h2 className="font-bold text-lg">Rincian Tarif</h2>
              <ul className="mt-2 flex flex-col gap-2">
                {journey.segments.map(segment => (
                  <li key={`${segment.from.id}-${segment.to.id}`} className="flex flex-row justify-between gap-4 bg-stone-100/80 rounded-xl px-4 py-3">
                    <div className="flex flex-col">
                      <b>{ operatorName(segment.operator) }</b>
                      <span className="text-sm text-slate-500 flex flex-row flex-wrap items-center gap-1">
                        { segment.from.name }
                        <CaretRightIcon weight="bold" className="w-3 h-3 shrink-0" />
                        { segment.to.name }
                      </span>
                    </div>
                    <b className="shrink-0">{ segment.fare !== null ? rupiah.format(segment.fare) : 'N/A' }</b>
                  </li>
                ))}
                {surchargedTransfers.map((leg, index) => (
                  <li key={`transfer-${index}`} className="flex flex-row justify-between gap-4 bg-stone-100/80 rounded-xl px-4 py-3">
                    <div className="flex flex-col">
                      <b>{ leg.corridorLabel }</b>
                      <span className="text-sm text-slate-500 flex flex-row flex-wrap items-center gap-1">
                        { leg.from.name }
                        <CaretRightIcon weight="bold" className="w-3 h-3 shrink-0" />
                        { leg.to.name }
                      </span>
                    </div>
                    <b className="shrink-0">{ rupiah.format(leg.fare) }</b>
                  </li>
                ))}
              </ul>
            </div>
          )
        : null}

      <p className="mt-6 text-xs text-slate-400">
        Estimasi berdasarkan tarif resmi per Juli 2026. Tarif LRT Jabodebek memakai batas atas jam sibuk; di luar jam sibuk dan akhir pekan bisa lebih murah
      </p>
    </>
  )
}

export default function FareResultCard({ result, alternatives = false }: {
  result: FareResult | TripResult
  /*
   * Whether to offer the other journeys the API returned.
   *
   * Off by default, so /fare and the search sheet render exactly what they
   * rendered before alternatives existed: one result, no badges, no cards to
   * choose between. Only /trip turns it on while the feature is unreleased.
   *
   * Gating here rather than at the route is what makes the staging real. All
   * three surfaces share FarePanel, so a route-level flag would have shipped
   * the cards to every one of them — including the /fare page embedded in
   * TransportForJakarta's site, which is the surface this is protecting.
   */
  alternatives?: boolean
}) {
  /*
   * Always the full list, so the hooks below never change shape; the primary is
   * sliced off afterwards when alternatives are off.
   *
   * Its labels go with them. A badge is a comparison — "paling murah" only means
   * anything beside the option it beats — so keeping them on a lone card would
   * boast about a choice the rider was never shown. Same rule the engine
   * applies when it declines to label a single journey.
   */
  const all = journeysOf(result)
  const journeys = alternatives ? all : all.slice(0, 1).map(j => ({ ...j, labels: [] }))
  const [selected, setSelected] = useState(0)

  /*
   * Reset on a new answer. The index is an ordinal into a set recomputed per
   * request, not a stable identifier: change the payment method and the third
   * option may be a different route, or may not exist at all.
   */
  useEffect(() => setSelected(0), [result])

  const journey = journeys[selected] ?? journeys[0]!

  return (
    <article className="mt-6">
      {journeys.length > 1
        ? (
            <div className="flex flex-col gap-2">
              {journeys.map((option, index) => (
                <JourneyCardFace
                  key={index}
                  journey={option}
                  selected={index === selected}
                  onSelect={() => setSelected(index)}
                />
              ))}
            </div>
          )
        : <JourneyCardFace journey={journey} selected />}

      <JourneyDetail journey={journey} />
    </article>
  )
}
