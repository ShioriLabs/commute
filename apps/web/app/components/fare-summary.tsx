import type { FareResult } from '@commute/schemas'
import { formatRupiah } from 'utils/format'

interface FareSummaryProps {
  // The two priced fields, so this reads a FareResult and a selected
  // FareJourney alike. See buildRouteOverlayModel for the same reasoning.
  fare: Pick<FareResult, 'totalFare' | 'transferCount'> | null
  hasError: boolean
  isLoading: boolean
}

/*
 * The one-line answer to "what does this route cost" — price plus transfer
 * count, or the loading and unavailable states around it.
 *
 * Split out of MapFareChip so the ladder lives in one place; the fare sheet
 * shows the total in its result card rather than its header, so the chip is
 * currently the only caller.
 */
export default function FareSummary({ fare, hasError, isLoading }: FareSummaryProps) {
  // A null totalFare is a real API answer ("no tariff for this pair"), not a
  // missing field, so it reads as unavailable rather than as still loading.
  const isUnavailable = hasError || (!isLoading && fare?.totalFare == null)
  const transferCount = fare?.transferCount ?? 0

  if (isLoading) {
    return <span className="animate-pulse bg-slate-200 rounded-full w-20 h-5" aria-label="Menghitung tarif..." />
  }

  if (isUnavailable) {
    return <span className="text-sm text-slate-500 truncate">Tarif tidak tersedia</span>
  }

  return (
    <span className="min-w-0 flex items-baseline gap-1.5 truncate">
      <b className="text-base text-slate-800">{ formatRupiah(fare!.totalFare!) }</b>
      {transferCount > 0 && (
        <span className="text-xs text-slate-500 whitespace-nowrap">
          {transferCount}
          x transit
        </span>
      )}
    </span>
  )
}
