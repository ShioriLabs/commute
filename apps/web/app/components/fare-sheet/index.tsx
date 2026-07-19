import type { Station } from 'models/stations'
import type { FareResult, FareResultRideLeg, FareResultTransferLeg } from 'models/fare'
import type { StandardResponse } from '@schema/response'
import { OPERATORS, type Operator } from '@commute/constants'
import { useEffect, useMemo, useState } from 'react'
import { CloseButton, DialogTitle } from '@headlessui/react'
import { ArrowsDownUpIcon, CaretDownIcon, CaretRightIcon, MapPinIcon, PersonSimpleWalkIcon, TicketIcon, XIcon, ShareNetworkIcon } from '@phosphor-icons/react'
import { useSearchParams } from 'react-router'
import useSWR from 'swr'
import { fetcher, FetchError } from 'utils/fetcher'
import { getForegroundColor } from 'utils/colors'
import StationPickerDialog from './station-picker'
import LineRoundel from '~/components/line-roundel'

const swrConfig = {
  dedupingInterval: import.meta.env.DEV ? 0 : 60 * 60 * 1000,
  focusThrottleInterval: import.meta.env.DEV ? 0 : 60 * 60 * 1000,
  revalidateOnFocus: false,
  shouldRetryOnError: false
}

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

function StationField({ label, station, onClick }: { label: string, station: Station | null, onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col gap-1 w-full text-left px-4 py-3 pr-16 rounded-xl bg-stone-100/80 border-2 border-stone-200/40 cursor-pointer"
    >
      <span className="text-sm font-semibold text-slate-500">{ label }</span>
      {station
        ? <b className="truncate w-full">{ station.formattedName ?? station.name }</b>
        : <span className="text-slate-400">Pilih stasiun</span>}
    </button>
  )
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
                  { directions.join(' / ') }
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

function FareResultCard({ result }: { result: FareResult }) {
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

// Rendered inside a headlessui Dialog in both contexts: the homepage
// SheetButton morph and the standalone /fare route (which wraps it in an
// always-open Dialog, same as the /settings route) — so CloseButton works.
export default function FareSheet() {
  const [searchParams] = useSearchParams()
  const { data: stations } = useSWR<StandardResponse<Station[]>>(new URL('/stations', import.meta.env.VITE_API_BASE_URL).href, fetcher, swrConfig)
  const [origin, setOrigin] = useState<Station | null>(null)
  const [destination, setDestination] = useState<Station | null>(null)
  // Which field is being picked never resets on close, so the picker title
  // stays correct while the dialog animates out.
  const [pickerTarget, setPickerTarget] = useState<'origin' | 'destination'>('origin')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [copied, setCopied] = useState(false)

  const openPickerFor = (target: 'origin' | 'destination') => {
    setPickerTarget(target)
    setPickerOpen(true)
  }

  useEffect(() => {
    const fromId = searchParams.get('from')
    const toId = searchParams.get('to')
    if (!fromId || !toId || !stations?.data) return

    const fromStation = stations.data.find(s => s.id === fromId)
    const toStation = stations.data.find(s => s.id === toId)
    if (fromStation && toStation) {
      setOrigin(fromStation)
      setDestination(toStation)
    }
  }, [stations?.data, searchParams])

  useEffect(() => {
    if (origin && destination) {
      const fromName = origin.formattedName ?? origin.name
      const toName = destination.formattedName ?? destination.name
      document.title = `Cek Tarif ${fromName} ke ${toName} - Commute`
    } else {
      document.title = 'Cek Tarif - Commute'
    }
  }, [origin, destination])

  const pickableStations = useMemo(
    // `searchable` matters since the TJ import: topology-only stops (TJ
    // feeder/non-BRT) are hidden from every search surface, and without the
    // filter they balloon the picker to ~2,300 rows.
    () => (stations?.data ?? []).filter(station => station.regionCode === 'CGK' && station.searchable),
    [stations?.data]
  )

  // On the homepage the sheet lives behind a faked URL (SheetButton pushStates
  // '/fare' while the router still thinks it's on '/'), so setSearchParams
  // would resolve against '/' and stomp the pathname. Write the query string
  // directly instead; window.location.pathname is '/fare' in both contexts,
  // and keeping history.state intact preserves SheetButton's modalOpen flag.
  const updateUrlParams = (fromId: string, toId: string) => {
    const params = new URLSearchParams({ from: fromId, to: toId })
    window.history.replaceState(window.history.state, '', `${window.location.pathname}?${params.toString()}`)
  }

  const fareUrl = origin && destination && origin.id !== destination.id
    ? new URL(`/fares/${origin.id}/${destination.id}`, import.meta.env.VITE_API_BASE_URL).href
    : null
  const { data: fare, error, isLoading } = useSWR<StandardResponse<FareResult>>(fareUrl, fetcher, swrConfig)

  const handleSwap = () => {
    setOrigin(destination)
    setDestination(origin)

    if (origin && destination) {
      updateUrlParams(destination.id, origin.id)
    }
  }

  const handleShare = async () => {
    const url = window.location.href
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'Cek Tarif Commute',
          url
        })
        return
      } catch {
        // User cancelled or share failed, fall back to clipboard.
      }
    }

    await navigator.clipboard.writeText(url)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleSelect = (station: Station) => {
    let newOrigin = origin
    let newDestination = destination

    if (pickerTarget === 'origin') {
      // Picking the other end's station swaps instead of dead-ending on SAME_STATION.
      if (station.id === destination?.id) newDestination = origin
      newOrigin = station
    } else {
      if (station.id === origin?.id) newOrigin = destination
      newDestination = station
    }

    setOrigin(newOrigin)
    setDestination(newDestination)

    if (newOrigin && newDestination) {
      updateUrlParams(newOrigin.id, newDestination.id)
    }
  }

  return (
    <section className="bg-white w-screen h-full overflow-y-auto">
      <div className="p-8 pb-4 max-w-3xl mx-auto">
        <div className="flex gap-4 items-center justify-between">
          <DialogTitle className="font-bold text-2xl">Cek Tarif</DialogTitle>
          <div className="flex gap-4">
            {origin && destination && (
              <button
                type="button"
                onClick={handleShare}
                aria-label="Bagikan rute ini"
                className="rounded-full leading-0 flex items-center justify-center w-8 h-8 cursor-pointer"
              >
                {copied ? <span className="text-[10px] font-bold text-green-600">✓</span> : <ShareNetworkIcon weight="bold" className="w-6 h-6" />}
              </button>
            )}
            <CloseButton
              aria-label="Tutup halaman cek tarif"
              className="rounded-full leading-0 flex items-center justify-center w-8 h-8 cursor-pointer"
            >
              <XIcon weight="bold" className="w-6 h-6" />
            </CloseButton>
          </div>
        </div>

        <div className="mt-4 relative flex flex-col gap-2">
          <StationField label="Dari" station={origin} onClick={() => openPickerFor('origin')} />
          <StationField label="Ke" station={destination} onClick={() => openPickerFor('destination')} />
          <button
            type="button"
            onClick={handleSwap}
            aria-label="Tukar stasiun asal dan tujuan"
            className="absolute right-4 top-1/2 -translate-y-1/2 z-[1] rounded-full bg-white border-2 border-stone-200/60 shadow-sm p-3 cursor-pointer"
          >
            <ArrowsDownUpIcon weight="bold" className="w-5 h-5" />
          </button>
        </div>

        {!origin || !destination
          ? (
              <div className="mt-12 flex flex-col items-center gap-2 text-slate-400">
                <MapPinIcon weight="duotone" className="w-12 h-12" />
                <p className="text-center">Pilih stasiun asal dan tujuan untuk melihat perkiraan tarif perjalananmu</p>
              </div>
            )
          : null}

        {isLoading
          ? (
              <div className="mt-6 animate-pulse flex flex-col gap-4">
                <div className="h-28 bg-slate-200 rounded-xl" />
                <div className="h-4 w-48 bg-slate-200 rounded" />
                <div className="h-4 w-32 bg-slate-200 rounded" />
              </div>
            )
          : null}

        {error
          ? (
              <div className="mt-6 p-4 bg-amber-100 text-amber-950 rounded-xl font-semibold">
                {error instanceof FetchError && error.status === 404
                  ? 'Rute tidak ditemukan untuk stasiun yang dipilih'
                  : 'Gagal memuat tarif, coba lagi nanti'}
              </div>
            )
          : null}

        {fare?.data ? <FareResultCard result={fare.data} /> : null}
      </div>

      <StationPickerDialog
        open={pickerOpen}
        title={pickerTarget === 'origin' ? 'Dari Stasiun' : 'Ke Stasiun'}
        stations={pickableStations}
        selectedId={(pickerTarget === 'origin' ? origin : destination)?.id ?? null}
        onClose={() => setPickerOpen(false)}
        onSelect={handleSelect}
      />
    </section>
  )
}
