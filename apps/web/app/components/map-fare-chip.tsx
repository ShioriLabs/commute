import { ArrowRightIcon, XIcon } from '@phosphor-icons/react'
import clsx from 'clsx'
import type { FareResult } from '@commute/schemas'
import type { PickableStation } from './fare-sheet/pickable-station'
import FareSummary from './fare-summary'

interface MapFareChipProps {
  /*
   * The drawn pair's two ends, or nulls while the fare query is still resolving
   * them. The same shape MapRailPill takes, from the same `railEndpoints` — the
   * names live on the resolved stations, not in the points manifest.
   */
  endpoints: { from: PickableStation | null, to: PickableStation | null }
  // The selected journey's total, not necessarily the response's — see
  // FareSummary.
  fare: Pick<FareResult, 'totalFare' | 'transferCount'> | null
  hasError: boolean
  isLoading: boolean
  onOpen: () => void
  onClear: () => void
}

/*
 * The drawn route's summary on phones, shown while the fare sheet is closed —
 * the map route gates that, so this stays presentational.
 *
 * It names the pair above the price rather than showing a bare total. A number
 * floating over the map answers "how much" without saying what for, and once a
 * rider has panned away from the highlighted corridor it is the only thing on
 * screen that could tell them which route they are looking at. This is the same
 * job the desktop rail card does with its two endpoint rows, at the size a
 * phone's bottom edge allows: one line, an arrow between the ends, truncated.
 *
 * Pinned bottom-LEFT, in the corner the fare button occupies before a pair is
 * drawn, so the summary appears where the control that produced it was. Centred
 * it had to reserve width for the corner buttons on both sides; left-aligned it
 * only clears the bottom-right pair.
 *
 * The body is tappable, which reverses an earlier decision worth recording. It
 * once linked into /fare, which unmounted the map; that link was removed, and
 * with the map's corner fare button standing by as the way back in, a chip that
 * looked tappable but only repeated the sheet header was a second answer to the
 * same question. The corner button is now hidden whenever this chip is up — the
 * two share the bottom edge and only one may hold it — so the chip is the only
 * route back into the sheet, and being inert would strand the rider with no way
 * to reopen their own result short of re-picking both stations.
 *
 * The X stays a sibling, not a child: nesting a button in a button is invalid,
 * and open and clear are different verbs that must not share a target.
 */
export default function MapFareChip({ endpoints, fare, hasError, isLoading, onOpen, onClear }: MapFareChipProps) {
  return (
    <div
      className={clsx(
        'map-chrome-enter absolute bottom-4 left-4 z-map-chrome',
        // Clears the bottom-right recenter/attribution pair: two 44px buttons,
        // their 1rem margin, and a gap between them and this.
        'max-w-[calc(100%-8.5rem)] rounded-2xl bg-white/90 backdrop-blur shadow-lg',
        'flex items-center'
      )}
    >
      <button
        type="button"
        onClick={onOpen}
        aria-label="Buka rincian tarif"
        className="flex flex-col items-start gap-0.5 pl-4 pr-1 py-2 min-w-0 cursor-pointer rounded-l-2xl transition-transform duration-150 ease-out active:scale-[0.99]"
      >
        {/*
          * Held at a fixed height while the names resolve, so the price below
          * does not jump up and back down as they land.
          */}
        <span className="flex items-center gap-1 min-w-0 max-w-full h-4 text-xs font-semibold text-slate-500">
          <span className="truncate">{endpoints.from?.name ?? '...'}</span>
          <ArrowRightIcon weight="bold" aria-hidden className="w-3 h-3 shrink-0" />
          <span className="truncate">{endpoints.to?.name ?? '...'}</span>
        </span>
        <FareSummary fare={fare} hasError={hasError} isLoading={isLoading} />
      </button>
      <button
        type="button"
        onClick={onClear}
        aria-label="Hapus rute dari peta"
        className="rounded-full flex items-center justify-center w-9 h-9 mr-1.5 ml-0.5 text-slate-700 hover:bg-slate-100 cursor-pointer shrink-0 transition-[background-color,transform] duration-150 ease active:scale-95"
      >
        <XIcon weight="bold" className="w-4 h-4" />
      </button>
    </div>
  )
}
