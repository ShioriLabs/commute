import type { Station } from 'models/stations'
import type { FareResult } from 'models/fare'
import type { StandardResponse } from '@schema/response'
import { OPERATORS, type Operator } from '@commute/constants'
import { useEffect, useMemo, useState } from 'react'
import { CloseButton, Dialog, DialogBackdrop, DialogPanel, DialogTitle } from '@headlessui/react'
import { ArrowsDownUpIcon, CaretRightIcon, MagnifyingGlassIcon, MapPinIcon, PersonSimpleWalkIcon, XIcon } from '@phosphor-icons/react'
import useSWR from 'swr'
import { fetcher, FetchError } from 'utils/fetcher'
import { getForegroundColor } from 'utils/colors'
import { levenshteinDistance } from 'utils/levenshtein'
import LineRoundel from '~/components/line-roundel'

const swrConfig = {
  dedupingInterval: import.meta.env.DEV ? 0 : 60 * 60 * 1000,
  focusThrottleInterval: import.meta.env.DEV ? 0 : 60 * 60 * 1000,
  revalidateOnFocus: false,
  shouldRetryOnError: false
}

const SCORE_THRESHOLD = 3

function getLevenshteinScore(station: Station, query: string) {
  const name = station.name.toLowerCase()
  const formattedName = station.formattedName?.toLowerCase() ?? ''
  const code = station.code.toLowerCase()
  const q = query.toLowerCase()

  if (name.includes(q) || formattedName.includes(q) || code.includes(q)) {
    return 0
  }

  return Math.min(
    levenshteinDistance(name, q),
    levenshteinDistance(formattedName, q),
    levenshteinDistance(code, q)
  )
}

const rupiah = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 })
const formatKm = (distanceM: number) => `${(distanceM / 1000).toLocaleString('id-ID', { maximumFractionDigits: 1 })} km`
const operatorName = (code: string) => (OPERATORS as Record<string, { name: string }>)[code as Operator]?.name ?? code

// Recently picked fare stations feed the quick-pick chips (same pattern as
// the search sheet's 'recently-searched').
const RECENT_PICKS_KEY = 'fare-recent-stations'
const RECENT_PICKS_MAX = 4

function StationPickerDialog({ open, title, stations, onClose, onSelect }: {
  open: boolean
  title: string
  stations: Station[]
  onClose: () => void
  onSelect: (station: Station) => void
}) {
  const [query, setQuery] = useState('')
  const [recentIds, setRecentIds] = useState<string[]>([])

  useEffect(() => {
    if (!open) return
    try {
      const parsed = JSON.parse(localStorage.getItem(RECENT_PICKS_KEY) ?? '[]') as unknown
      if (parsed instanceof Array) setRecentIds(parsed as string[])
    } catch {
      // Corrupt entry: fall back to popularity-only chips.
    }
  }, [open])

  const shownStations = useMemo(() => {
    if (query.length < 2) {
      // No query: full list, most popular first, so common picks are one tap away.
      return [...stations].sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || a.name.localeCompare(b.name))
    }
    return stations
      .map(station => ({ station, finalScore: getLevenshteinScore(station, query) + (1 - (station.score ?? 0) / 100) }))
      .filter(({ finalScore }) => finalScore < SCORE_THRESHOLD)
      .sort((a, b) => a.finalScore - b.finalScore || a.station.name.localeCompare(b.station.name))
      .map(({ station }) => station)
  }, [query, stations])

  // Recent picks first, padded with the most popular stations for first-time
  // users (and when recents fall outside the pickable set).
  const quickPicks = useMemo(() => {
    const byId = new Map(stations.map(station => [station.id, station]))
    const picks: Station[] = []
    for (const id of recentIds) {
      const station = byId.get(id)
      if (station && !picks.some(pick => pick.id === station.id)) picks.push(station)
      if (picks.length === RECENT_PICKS_MAX) return picks
    }
    const popular = [...stations].sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    for (const station of popular) {
      if (picks.some(pick => pick.id === station.id)) continue
      picks.push(station)
      if (picks.length === RECENT_PICKS_MAX) break
    }
    return picks
  }, [recentIds, stations])

  const handleSelect = (station: Station) => {
    const newRecents = [station.id, ...recentIds.filter(id => id !== station.id)].slice(0, RECENT_PICKS_MAX)
    setRecentIds(newRecents)
    localStorage.setItem(RECENT_PICKS_KEY, JSON.stringify(newRecents))
    onSelect(station)
    setQuery('')
    onClose()
  }

  return (
    <Dialog open={open} onClose={onClose} className="relative z-50">
      <DialogBackdrop transition className="fixed inset-0 bg-white/90 duration-200 ease-out data-closed:opacity-0" />
      <div className="fixed inset-0 flex w-screen">
        <DialogPanel className="bg-white w-screen h-screen overflow-y-auto">
          <div className="p-8 pb-4 sticky top-0 max-w-3xl mx-auto bg-white">
            <div className="flex gap-4 items-center justify-between">
              <h1 className="font-bold text-2xl">{ title }</h1>
              <button
                onClick={onClose}
                aria-label="Tutup pemilihan stasiun"
                className="rounded-full leading-0 flex items-center justify-center w-8 h-8 cursor-pointer"
              >
                <XIcon weight="bold" className="w-6 h-6" />
              </button>
            </div>
            <div className="relative mt-4">
              <MagnifyingGlassIcon weight="bold" className="w-5 h-5 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              <input
                className="w-full pl-11 pr-4 py-2.5 rounded-xl bg-stone-100/80 border-2 border-stone-200/40 focus:outline-2 focus:outline-[#F55875]/60"
                type="text"
                placeholder="Masukkan nama stasiun atau kode stasiun"
                value={query}
                onChange={e => setQuery(e.target.value)}
                aria-label="Cari stasiun berdasarkan nama atau kode"
              />
            </div>
          </div>
          {query.length < 2 && quickPicks.length > 0
            ? (
                <div className="max-w-3xl mx-auto">
                  <span className="block px-8 pt-1 text-xs font-bold uppercase tracking-wide text-slate-400">Sering dipilih</span>
                  <div className="px-8 pt-2 pb-1 flex gap-2 overflow-x-auto no-scrollbar">
                    {quickPicks.map(station => (
                      <button
                        key={station.id}
                        type="button"
                        onClick={() => handleSelect(station)}
                        className="shrink-0 rounded-full bg-rose-100 text-pink-800 pl-2 pr-3.5 py-1.5 flex items-center gap-2 text-sm font-semibold cursor-pointer"
                      >
                        {station.lines?.length
                          ? (
                              <span className="flex -space-x-1.5">
                                {station.lines.map(line => (
                                  <LineRoundel key={line.lineCode} size="SM" code={line.lineCode} color={line.colorCode} />
                                ))}
                              </span>
                            )
                          : null}
                        { station.formattedName ?? station.name }
                      </button>
                    ))}
                  </div>
                </div>
              )
            : null}
          <ul className="mt-2 max-w-3xl mx-auto pb-8">
            {shownStations.map(station => (
              <li key={station.id}>
                <button
                  type="button"
                  onClick={() => handleSelect(station)}
                  className="px-8 py-3 flex flex-col gap-1 w-full text-left cursor-pointer hover:bg-rose-50/60"
                >
                  <b className="text-lg">
                    { station.formattedName ?? station.name }
                    {'  '}
                    <span className="text-sm font-semibold text-gray-600">{ station.operator.name }</span>
                  </b>
                  {station.lines?.length
                    ? (
                        <ul className="flex flex-row gap-1 flex-wrap">
                          {station.lines.map(line => (
                            <li key={line.lineCode}>
                              <LineRoundel size="SM" code={line.lineCode} color={line.colorCode} />
                              <span className="sr-only">{line.name}</span>
                            </li>
                          ))}
                        </ul>
                      )
                    : null}
                </button>
              </li>
            ))}
          </ul>
        </DialogPanel>
      </div>
    </Dialog>
  )
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

        return leg.type === 'RIDE'
          ? (
              <li key={index} className="flex flex-col">
                {isSameStationTransfer
                  ? (
                      <div className="flex items-stretch gap-3">
                        <span className="w-4 flex justify-center shrink-0">
                          <span className="w-1.5 rounded-full bg-slate-300" />
                        </span>
                        <div className="flex items-center gap-1.5 text-sm text-slate-500 py-1.5">
                          <ArrowsDownUpIcon weight="bold" className="w-3.5 h-3.5" />
                          <span>Pindah kereta</span>
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
                    <span className="w-1.5 rounded-full" style={{ backgroundColor: leg.lineColor }} />
                  </span>
                  <div className="flex-1 my-2 bg-stone-100/80 rounded-xl p-3 flex flex-col gap-1 items-start">
                    <span
                      className={`text-sm font-semibold px-3 py-1 rounded-full w-fit ${getForegroundColor(leg.lineColor) === 'LIGHT' ? 'text-white' : 'text-slate-900'}`}
                      style={{ backgroundColor: leg.lineColor }}
                    >
                      { leg.lineName }
                    </span>
                    <span className="text-sm text-slate-500">
                      { leg.stationCount - 1 }
                      {' '}
                      stasiun •
                      {' '}
                      { formatKm(leg.distanceM) }
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="w-4 h-4 rounded-full border-[5px] bg-white shrink-0" style={{ borderColor: leg.lineColor }} />
                  <b className="text-lg">{leg.to.name}</b>
                </div>
              </li>
            )
          : (
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
  return (
    <article className="mt-6">
      <div className="bg-rose-50 rounded-xl p-6 flex flex-col gap-1">
        <span className="text-sm font-semibold text-slate-500">Total Tarif</span>
        <span className="text-3xl font-bold">
          {result.totalFare !== null ? rupiah.format(result.totalFare) : 'Tarif tidak tersedia'}
        </span>
        <span className="text-sm text-slate-500">
          {formatKm(result.totalDistanceM)}
          {result.transferCount > 0 ? ` • ${result.transferCount}x transit` : ''}
        </span>
      </div>
      <JourneyTimeline result={result} />

      {result.segments.length > 1
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
  const { data: stations } = useSWR<StandardResponse<Station[]>>(new URL('/stations', import.meta.env.VITE_API_BASE_URL).href, fetcher, swrConfig)
  const [origin, setOrigin] = useState<Station | null>(null)
  const [destination, setDestination] = useState<Station | null>(null)
  const [openPicker, setOpenPicker] = useState<'origin' | 'destination' | null>(null)

  const pickableStations = useMemo(
    () => (stations?.data ?? []).filter(station => station.regionCode === 'CGK'),
    [stations?.data]
  )

  const fareUrl = origin && destination && origin.id !== destination.id
    ? new URL(`/fares/${origin.id}/${destination.id}`, import.meta.env.VITE_API_BASE_URL).href
    : null
  const { data: fare, error, isLoading } = useSWR<StandardResponse<FareResult>>(fareUrl, fetcher, swrConfig)

  const handleSwap = () => {
    setOrigin(destination)
    setDestination(origin)
  }

  const handleSelect = (station: Station) => {
    if (openPicker === 'origin') {
      // Picking the other end's station swaps instead of dead-ending on SAME_STATION.
      if (station.id === destination?.id) setDestination(origin)
      setOrigin(station)
    } else if (openPicker === 'destination') {
      if (station.id === origin?.id) setOrigin(destination)
      setDestination(station)
    }
  }

  return (
    <section className="bg-white w-screen h-full overflow-y-auto">
      <div className="p-8 pb-4 max-w-3xl mx-auto">
        <div className="flex gap-4 items-center justify-between">
          <DialogTitle className="font-bold text-2xl">Cek Tarif</DialogTitle>
          <CloseButton
            aria-label="Tutup halaman cek tarif"
            className="rounded-full leading-0 flex items-center justify-center w-8 h-8 cursor-pointer"
          >
            <XIcon weight="bold" className="w-6 h-6" />
          </CloseButton>
        </div>

        <div className="mt-4 relative flex flex-col gap-2">
          <StationField label="Dari" station={origin} onClick={() => setOpenPicker('origin')} />
          <StationField label="Ke" station={destination} onClick={() => setOpenPicker('destination')} />
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
        open={openPicker !== null}
        title={openPicker === 'origin' ? 'Dari Stasiun' : 'Ke Stasiun'}
        stations={pickableStations}
        onClose={() => setOpenPicker(null)}
        onSelect={handleSelect}
      />
    </section>
  )
}
