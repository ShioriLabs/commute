import { ArrowSquareOutIcon, XIcon } from '@phosphor-icons/react'
import { Link } from 'react-router'
import { buildFarePath } from 'utils/fare-url'
import DetailSurface from './detail-surface'
import FarePanel from './fare-sheet/fare-panel'
import FareShareButton from './fare-sheet/fare-share-button'
import type { FareQuery } from './fare-sheet/use-fare-query'
import type { FareRouter } from 'utils/fare-router'

interface MapFareSheetProps {
  open: boolean
  /*
   * Snap this opening lands on. 'full' for the cold open from the map's fare
   * button — both fields are empty, there is nothing to peek at, and the rider's
   * next act is picking a station. 'peek' when a completed pair opens it, so the
   * route it prices stays on screen behind it.
   */
  initialSnap?: 'peek' | 'full'
  /*
   * The map route's single FareQuery. Owned there rather than here because this
   * component unmounts when the sheet closes (DetailSurface renders null) and
   * the pair has to outlive that — and because the same query feeds the route
   * overlay and the chip, which is what keeps all three on one SWR entry.
   */
  query: FareQuery
  /*
   * Router choice and journey selection, both owned by the map route.
   *
   * This sheet is the only surface that does not own either: the map draws the
   * selected journey on the canvas behind it and prices it in the chip, so the
   * choice has to outlive a sheet that unmounts on close.
   */
  /*
   * Optional, and both-or-neither — the same gate FarePanel documents.
   *
   * Desktop passes neither: the rail column owns the router toggle and the
   * options list there, and this one sheet instance serves both form factors,
   * so the props are what decide which surface carries them rather than two
   * separate components.
   */
  router?: FareRouter
  onRouterChange?: (router: FareRouter) => void
  alternatives: boolean
  selectedIndex: number
  onSelectIndex: (index: number) => void
  /*
   * Fires when the exit begins, where onClose fires only once it has finished.
   * The map moves its camera off this: the surface stays mounted for the whole
   * 250ms slide, so waiting for onClose would inset the map until after the
   * card had already left.
   */
  onDismissStart?: () => void
  onClose: () => void
}

/*
 * The fare panel on the map's detail surface: a draggable bottom sheet on
 * phones, a side pane on desktop — the same surface station and hub details
 * use, so checking a fare is something you do on the map rather than somewhere
 * you go instead of it.
 *
 * Reuses FarePanel, not FareSheet: FareSheet wraps the panel in its own
 * overflow-y-auto section (which would nest a scroll container inside
 * BottomSheet's hand-driven scrollTop) and leans on Headless UI's DialogTitle
 * and CloseButton, neither of which works outside a Dialog. The header below is
 * the local equivalent, mirroring station-sheet.tsx's.
 */
export default function MapFareSheet({
  open,
  initialSnap,
  query,
  router,
  onRouterChange,
  alternatives,
  selectedIndex,
  onSelectIndex,
  onDismissStart,
  onClose
}: MapFareSheetProps) {
  const { pairFromId, pairToId, criteria } = query
  /*
   * Built from the fetched pair, not the resolved stations: the search index
   * omits TJ topology-only halte, so a perfectly good pair can leave
   * `origin`/`destination` null while the fare prices fine.
   */
  const farePath = buildFarePath(pairFromId, pairToId, criteria)

  return (
    <DetailSurface
      open={open}
      initialSnap={initialSnap}
      onDismissStart={onDismissStart}
      onClose={onClose}
      ariaLabel="Cek tarif"
      header={close => (
        <div className="flex gap-4 items-center justify-between">
          <h2 className="font-bold text-xl truncate">Cek Tarif</h2>
          <div className="flex gap-4 shrink-0">
            <FareShareButton fromId={pairFromId} toId={pairToId} criteria={criteria} />
            <button
              type="button"
              onClick={close}
              aria-label="Tutup cek tarif"
              className="rounded-full leading-0 flex items-center justify-center w-8 h-8 cursor-pointer"
            >
              <XIcon weight="bold" className="w-6 h-6" />
            </button>
          </div>
        </div>
      )}
    >
      {ready => (ready
        ? (
            // px-8 is load-bearing: CriteriaBar's rail assumes 8-unit parent
            // padding, the same as /fare's p-8 and the search sheet's px-8.
            <div className="px-8 pb-8">
              <FarePanel
                query={query}
                wrapCriteria
                alternatives={alternatives}
                router={router}
                onRouterChange={onRouterChange}
                selectedIndex={selectedIndex}
                onSelectIndex={onSelectIndex}
                footer={farePath
                  ? (
                      <Link
                        to={farePath}
                        className="mt-4 flex items-center justify-center gap-2 text-sm font-semibold text-slate-500 cursor-pointer"
                      >
                        Buka halaman tarif
                        <ArrowSquareOutIcon weight="bold" className="w-4 h-4" />
                      </Link>
                    )
                  : null}
              />
            </div>
          )
        : (
            <div className="px-8 pt-4">
              <div className="animate-pulse w-full h-32 bg-slate-200 rounded-lg" />
            </div>
          ))}
    </DetailSurface>
  )
}
