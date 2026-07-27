import type { FareResult, FareResultRideLeg, FareResultTransferLeg } from 'models/fare'
import { OPERATORS, type Operator } from '@commute/constants'
import { useState } from 'react'
import { ArrowsDownUpIcon, CaretDownIcon, CaretRightIcon, PersonSimpleWalkIcon, TicketIcon } from '@phosphor-icons/react'
import { getForegroundColor } from 'utils/colors'
import { joinLabels } from 'utils/labels'
import LineRoundel from '~/components/line-roundel'

const rupiah = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 })
const formatKm = (distanceM: number) => `${(distanceM / 1000).toLocaleString('id-ID', { maximumFractionDigits: 1 })} km`
const operatorName = (code: string) => (OPERATORS as Record<string, { name: string }>)[code as Operator]?.name ?? code

// At-a-glance segment fill: a gradient across the service colours for interlined
// legs (shared track), otherwise the single line colour.
function rideGlanceStyle(leg: FareResultRideLeg) {
  const lines = leg.serviceLines
  if (lines && lines.length > 1) {
    return { flexGrow: leg.distanceM, backgroundImage: `linear-gradient(to right, ${lines[0].lineColor}, ${lines[lines.length - 1].lineColor})` }
  }
  return { flexGrow: leg.distanceM, backgroundColor: leg.lineColor }
}

// One ride leg: board node, line-colored connector carrying the service card
// (line pill, headsign, expandable intermediate stops), alight node.
function RideLeg({ leg, isSameStationTransfer }: { leg: FareResultRideLeg, isSameStationTransfer: boolean }) {
  const [expanded, setExpanded] = useState(false)
  // Optional-chained against a stale API during deploy skew.
  const intermediate = leg.stops?.slice(1, -1) ?? []
  const summary = `${leg.stationCount - 1} stasiun • ${formatKm(leg.distanceM)}`
  // On interlined track (the LRT Jabodebek trunk) several service lines run the
  // same leg — any train works. Fall back to the single line for ordinary legs.
  const lines = leg.serviceLines ?? [{ lineCode: leg.lineCode, lineName: leg.lineName, lineColor: leg.lineColor, headsign: leg.headsign }]
  const isInterlined = lines.length > 1
  const directions = [...new Set(lines.map(line => line.headsign).filter((headsign): headsign is string => headsign !== null))]
  const railStyle = isInterlined
    ? { backgroundImage: `repeating-linear-gradient(to bottom, ${lines[0].lineColor} 0 8px, ${lines[lines.length - 1].lineColor} 8px 16px)` }
    : { backgroundColor: leg.lineColor }

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
        <span className="w-4 h-4 rounded-full border-[5px] bg-white shrink-0" style={{ borderColor: leg.lineColor }} />
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
                          <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: leg.lineColor }} />
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
        <span className="w-4 h-4 rounded-full border-[5px] bg-white shrink-0" style={{ borderColor: leg.lineColor }} />
        <b className="text-lg">{leg.to.name}</b>
      </div>
    </li>
  )
}

// Itinerary timeline: ringed nodes at board/alight stations, line-colored
// connectors carrying the service card, walks as full-width cards that break
// the rail (TfL Go-style).
function JourneyTimeline({ result }: { result: FareResult }) {
  return (
    <ol className="mt-6 flex flex-col">
      {result.legs.map((leg, index) => {
        // Two consecutive rides through the same station = same-station
        // interchange (no walk leg): bridge the islands with a grey rail.
        const previous = index > 0 ? result.legs[index - 1] : null
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

export default function FareResultCard({ result }: { result: FareResult }) {
  // Surcharged transfers (e.g. the Dukuh Atas corridor) aren't ride segments but
  // do contribute to totalFare, so they need their own breakdown rows for the
  // line items to reconcile with the total.
  const surchargedTransfers = result.legs.filter(
    (leg): leg is FareResultTransferLeg & { fare: number, corridorLabel: string } =>
      leg.type === 'TRANSFER' && leg.fare != null && leg.corridorLabel != null
  )

  return (
    <article className="mt-6">
      <div className="bg-rose-50 rounded-xl p-6 flex flex-col gap-1">
        <span className="text-sm font-semibold text-slate-500">Total Tarif</span>
        <span className="text-3xl font-bold">
          {result.totalFare !== null ? rupiah.format(result.totalFare) : 'Tarif tidak tersedia'}
        </span>
        {/* Journey at a glance: ride legs proportional to distance, walks as dots. */}
        <div className="my-1 flex h-2 gap-0.5" aria-hidden="true">
          {result.legs.map((leg, index) => leg.type === 'RIDE'
            ? <span key={index} className="rounded-full min-w-2" style={rideGlanceStyle(leg)} />
            : <span key={index} className="w-1.5 shrink-0 rounded-full bg-slate-300" />)}
        </div>
        <span className="text-sm text-slate-500">
          {formatKm(result.totalDistanceM)}
          {result.transferCount > 0 ? ` • ${result.transferCount}x transit` : ''}
        </span>
      </div>
      <JourneyTimeline result={result} />

      {result.segments.length + surchargedTransfers.length > 1
        ? (
            <div className="mt-2">
              <h2 className="font-bold text-lg">Rincian Tarif</h2>
              <ul className="mt-2 flex flex-col gap-2">
                {result.segments.map(segment => (
                  <li key={`${segment.fromStationId}-${segment.toStationId}`} className="flex flex-row justify-between gap-4 bg-stone-100/80 rounded-xl px-4 py-3">
                    <div className="flex flex-col">
                      <b>{ operatorName(segment.operator) }</b>
                      <span className="text-sm text-slate-500 flex flex-row flex-wrap items-center gap-1">
                        { segment.fromName }
                        <CaretRightIcon weight="bold" className="w-3 h-3 shrink-0" />
                        { segment.toName }
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
        Estimasi berdasarkan tarif resmi per Juli 2026. Tarif LRT Jabodebek memakai batas atas jam sibuk; di luar jam sibuk dan akhir pekan bisa lebih murah.
      </p>
    </article>
  )
}
