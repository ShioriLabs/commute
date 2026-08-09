import { XIcon } from '@phosphor-icons/react'
import clsx from 'clsx'
import type { FareResult } from '@commute/schemas'
import FareSummary from './fare-summary'

interface MapFareChipProps {
  // The selected journey's total, not necessarily the response's — see
  // FareSummary.
  fare: Pick<FareResult, 'totalFare' | 'transferCount'> | null
  hasError: boolean
  isLoading: boolean
  onClear: () => void
}

/*
 * Floating fare total for the map's route overlay, shown while the fare sheet
 * is closed — the map route gates that, so this stays presentational.
 *
 * The body is deliberately inert. It used to link into /fare, which unmounted
 * the map; the detail view is now the fare sheet, reached from the map's fare
 * button, and a chip that looks tappable but only repeats what the sheet header
 * already says would be a second answer to the same question. The X remains the
 * way out of route mode.
 */
export default function MapFareChip({ fare, hasError, isLoading, onClear }: MapFareChipProps) {
  return (
    <div
      className={clsx(
        'map-chrome-enter absolute bottom-4 left-1/2 -translate-x-1/2 z-20',
        'max-w-[calc(100%-9rem)] rounded-full bg-white/90 backdrop-blur shadow-lg',
        'flex items-center'
      )}
    >
      <div className="flex items-center gap-1.5 pl-4 pr-1 py-2.5 min-w-0">
        <FareSummary fare={fare} hasError={hasError} isLoading={isLoading} />
      </div>
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
