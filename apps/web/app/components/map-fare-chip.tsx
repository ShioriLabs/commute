import { XIcon, CaretRightIcon } from '@phosphor-icons/react'
import { Link } from 'react-router'
import clsx from 'clsx'
import type { FareResult } from '@commute/schemas'
import { buildFarePath } from 'utils/fare-url'

const rupiah = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 })

interface MapFareChipProps {
  fromId: string
  toId: string
  fare: FareResult | null
  hasError: boolean
  isLoading: boolean
  onClear: () => void
}

// Floating fare summary for the map's route overlay. The body links into the
// full fare page (same pair, served from the shared SWR cache); the X is the
// only way out of route mode, so it is always present.
export default function MapFareChip({ fromId, toId, fare, hasError, isLoading, onClear }: MapFareChipProps) {
  const farePath = buildFarePath(fromId, toId)
  const isUnavailable = hasError || (!isLoading && fare?.totalFare == null)
  const transferCount = fare?.transferCount ?? 0

  return (
    <div
      className={clsx(
        'map-chrome-enter absolute bottom-4 left-1/2 -translate-x-1/2 z-20',
        'max-w-[calc(100%-9rem)] rounded-full bg-white/90 backdrop-blur shadow-lg',
        'flex items-center'
      )}
    >
      <Link
        to={farePath ?? '/fare'}
        className="flex items-center gap-1.5 pl-4 pr-1 py-2.5 min-w-0 cursor-pointer"
        aria-label="Lihat rincian tarif"
      >
        {isLoading && (
          <span className="animate-pulse bg-slate-200 rounded-full w-20 h-5" aria-label="Menghitung tarif..." />
        )}
        {!isLoading && isUnavailable && (
          <span className="text-sm text-slate-500 truncate">Tarif tidak tersedia</span>
        )}
        {!isLoading && !isUnavailable && (
          <span className="min-w-0 flex items-baseline gap-1.5 truncate">
            <b className="text-base text-slate-800">{rupiah.format(fare!.totalFare!)}</b>
            {transferCount > 0 && (
              <span className="text-xs text-slate-500 whitespace-nowrap">
                {transferCount}
                x transit
              </span>
            )}
          </span>
        )}
        <CaretRightIcon weight="bold" className="w-4 h-4 text-slate-400 shrink-0" />
      </Link>
      <button
        type="button"
        onClick={onClear}
        aria-label="Hapus rute dari peta"
        className="rounded-full flex items-center justify-center w-9 h-9 mr-1 text-slate-700 hover:bg-slate-100 cursor-pointer shrink-0"
      >
        <XIcon weight="bold" className="w-4 h-4" />
      </button>
    </div>
  )
}
