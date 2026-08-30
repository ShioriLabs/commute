import { ArrowDownIcon, MagnifyingGlassIcon, XIcon } from '@phosphor-icons/react'
import clsx from 'clsx'
import type { FareResult } from '@commute/schemas'
import { useReducedMotion } from '~/hooks/reduced-motion'
import LineRoundel from './line-roundel'
import type { PickableStation } from './fare-sheet/pickable-station'
import FareSummary from './fare-summary'

interface MapRailPillProps {
  /*
   * The drawn pair's two ends, or nulls while the fare query is still resolving
   * them. A pair is what switches this from the idle pill to the route card.
   *
   * The resolved stations rather than bare names, so each row can be signed
   * with its line's roundel the way the rest of the fare UI signs a stop.
   */
  endpoints: { from: PickableStation | null, to: PickableStation | null }
  hasPair: boolean
  // The selected journey's total, not necessarily the response's — see
  // FareSummary.
  fare: Pick<FareResult, 'totalFare' | 'transferCount'> | null
  hasError: boolean
  isLoading: boolean
  onOpenFare: () => void
  onClear: () => void
}

// The collapsed head's own height. The margins around it live in the rail's
// wrapper; together they make up RAIL_PILL_RESERVED_PX (12 + 52 + 12 = 76),
// which is where the pane docks.
const PILL_HEIGHT_PX = 52

// Shared by both states so the card reads as the pill having grown rather than
// as a different object replacing it.
const SURFACE_CLASS = 'rounded-2xl bg-white/90 backdrop-blur shadow-lg'

// The mark column both stops and the arrow between them share. Fixed rather
// than intrinsic so the two names start on the same x whether a row shows a
// roundel or the placeholder dot, and so the arrow can centre on it.
const ROUNDEL_COL = 'w-6 shrink-0'

/*
 * One end of the drawn pair.
 *
 * Signed with the line's roundel rather than the station's own number: the fare
 * response carries no station numbers (there is no `fromNumber`/`toNumber` on
 * the wire), and PickableStation resolves lines, not positions. The line
 * roundel is what the rest of the fare UI — the route bar, the result card —
 * uses to sign a stop, so this stays consistent with them rather than inventing
 * a second vocabulary. A true M07-style station roundel needs the API to send
 * the number first.
 *
 * An interchange carries several lines; the first in display order stands for
 * the stop, because the row names one station and a row of roundels would
 * compete with the name for the width.
 */
function EndpointRow({ station, placeholder, emphasis = false }: {
  station: PickableStation | null
  placeholder: string
  emphasis?: boolean
}) {
  const line = station?.sortedLines[0]
  return (
    <li className="flex items-center gap-2 min-w-0 h-7">
      <span className={clsx(ROUNDEL_COL, 'flex justify-center')}>
        {line
          ? (
              <LineRoundel
                size="SM"
                // The station's operator, not the line's: the resolved line
                // carries `mode` (how it runs), while the roundel's filled-vs-
                // ringed style keys off who runs it.
                operator={station.operator}
                code={line.lineCode}
                color={line.colorCode as `#${string}`}
              />
            )
          // No lines resolved yet: a neutral dot holds the column so the name
          // does not shift left when the roundel arrives.
          : <span className="w-2 h-2 rounded-full bg-slate-300" aria-hidden />}
      </span>
      <span className={clsx(
        'text-sm truncate',
        emphasis ? 'font-semibold text-slate-800' : 'text-slate-700',
        !station && 'text-slate-400'
      )}
      >
        {station?.name ?? placeholder}
      </span>
    </li>
  )
}

/*
 * The desktop rail's head: a fare affordance that becomes the drawn route's
 * summary.
 *
 * One element in two states rather than two elements swapping, because the
 * rider's eye is already on it when the pair completes — growing in place says
 * "your route went here", where a pill disappearing and a card appearing
 * somewhere else says nothing. It also means the pane below it only ever has
 * one thing to dock under.
 *
 * Desktop only. Phones keep the corner button and the floating chip, which suit
 * a viewport where the four corners are the only free space.
 */
export default function MapRailPill({
  endpoints,
  hasPair,
  fare,
  hasError,
  isLoading,
  onOpenFare,
  onClear
}: MapRailPillProps) {
  const reduced = useReducedMotion()
  return (
    <div className={clsx('w-full', SURFACE_CLASS, 'overflow-hidden')}>
      {/*
        * The idle row keeps its height in both states and turns into the card's
        * header, so nothing jumps as the rows below it open.
        */}
      <button
        type="button"
        onClick={onOpenFare}
        aria-label="Cek tarif perjalanan"
        style={{ height: PILL_HEIGHT_PX }}
        className={clsx(
          'w-full flex items-center gap-3 px-4 text-left cursor-pointer',
          'transition-transform duration-150 ease-out active:scale-[0.99]',
          // Rounded on its own only while it IS the whole surface; once the card
          // is open it is the top of a taller box.
          hasPair ? 'rounded-t-2xl' : 'rounded-2xl'
        )}
      >
        <MagnifyingGlassIcon weight="bold" className="w-5 h-5 text-slate-400 shrink-0" />
        <span className="font-bold text-base text-slate-800 truncate">
          {hasPair ? 'Ubah rute' : 'Cek tarif'}
        </span>
      </button>

      {/*
        * Grid-rows rather than height: `1fr`/`0fr` transitions on the GPU-free
        * layout path but without a magic pixel number, so the card can be as
        * tall as the two station names need. `min-h-0` on the child is what lets
        * the collapsed state actually reach zero.
        */}
      <div
        className="grid"
        style={{
          gridTemplateRows: hasPair ? '1fr' : '0fr',
          transition: reduced ? undefined : 'grid-template-rows 200ms cubic-bezier(0.23, 1, 0.32, 1)'
        }}
      >
        <div className="min-h-0 overflow-hidden">
          {/* pt-3, not pt-1: the roundels are taller than a text row, and at a
              tighter top padding the first one's ring was shaved by the card's
              own overflow-hidden. */}
          <div className="px-4 pb-3 pt-3 border-t border-slate-100">
            <ol className="flex flex-col py-1">
              <EndpointRow station={endpoints.from} placeholder="Pilih keberangkatan" />
              {/*
                * Centred on the roundel column rather than nudged with padding:
                * the arrow marks the line between the two stops, so it has to
                * sit under the mark it joins whatever width that mark is.
                */}
              <li aria-hidden className="flex items-center h-3">
                <span className={clsx(ROUNDEL_COL, 'flex justify-center')}>
                  <ArrowDownIcon weight="bold" className="w-3 h-3 text-slate-300" />
                </span>
              </li>
              <EndpointRow station={endpoints.to} placeholder="Pilih tujuan" emphasis />
            </ol>
            <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-100">
              <div className="flex items-center min-w-0">
                <FareSummary fare={fare} hasError={hasError} isLoading={isLoading} />
              </div>
              <button
                type="button"
                onClick={onClear}
                aria-label="Hapus rute dari peta"
                // Untabbable while collapsed: the rows are still in the DOM so
                // they can animate, and a hidden control in the tab order is a
                // focus trap the rider cannot see.
                tabIndex={hasPair ? 0 : -1}
                className="rounded-full flex items-center justify-center w-9 h-9 -mr-1.5 text-slate-700 hover:bg-slate-100 cursor-pointer shrink-0"
              >
                <XIcon weight="bold" className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
