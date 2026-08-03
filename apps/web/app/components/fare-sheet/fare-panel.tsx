import type { ReactNode } from 'react'
import { ArrowsDownUpIcon, MapPinIcon } from '@phosphor-icons/react'
import { FetchError } from 'utils/fetcher'
import CriteriaBar from './criteria/criteria-bar'
import FareResultCard from './fare-result-card'
import StationField from './station-field'
import StationPickerDialog from './station-picker'
import type { FareQuery } from './use-fare-query'

interface Props {
  query: FareQuery
  // Rendered under the result when a fare is showing. The search sheet uses this
  // for its "open on /fare" link, which is how a route found in the sheet
  // becomes a shareable URL — see utils/fare-url.ts.
  footer?: ReactNode
  // Wrap the criteria chips instead of scrolling them. Set by the map's fare
  // sheet, where a horizontally-scrolling rail cannot work — see CriteriaBar.
  wrapCriteria?: boolean
  // Offer the alternative journeys. Only /trip does while the feature is
  // unreleased; see FareResultCard.
  alternatives?: boolean
}

// The fare query body: the Dari/Ke pair, the swap control, and whichever of
// empty/loading/error/result applies. Shared verbatim by the /fare route and the
// search sheet's route mode, so the two can never drift apart visually.
export default function FarePanel({ query, footer, wrapCriteria = false, alternatives = false }: Props) {
  const {
    origin,
    destination,
    pickerTarget,
    pickerOpen,
    openPickerFor,
    closePicker,
    handleSelect,
    handleSwap,
    pickableStations,
    operators,
    criteria,
    setCriteria,
    fare,
    error,
    isLoading
  } = query

  return (
    <>
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

      <CriteriaBar
        criteria={criteria}
        onChange={setCriteria}
        operators={operators}
        wrap={wrapCriteria}
      />

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

      {fare?.data ? <FareResultCard result={fare.data} alternatives={alternatives} /> : null}
      {fare?.data ? footer : null}

      <StationPickerDialog
        open={pickerOpen}
        title={pickerTarget === 'origin' ? 'Dari Stasiun' : 'Ke Stasiun'}
        stations={pickableStations}
        selectedId={(pickerTarget === 'origin' ? origin : destination)?.id ?? null}
        onClose={closePicker}
        onSelect={handleSelect}
      />
    </>
  )
}
