import { ArrowLeftIcon, XIcon } from '@phosphor-icons/react'
import SidePane from '../side-pane'
import StationContent, { useStationHeader } from '../station-content'
import { StationPaneHeader } from '../station-sheet'
import TimetableContent from '../timetable-content'
import { useDeckSlot } from './context'
import type { PaneDescriptor } from './model'

interface PaneCardProps {
  pane: PaneDescriptor
  /** Fires once this card's exit animation has landed. The provider drops the
   * entry here — never by flipping `open`, which would unmount the card
   * instantly and skip the animation entirely. */
  onClose: () => void
}

/**
 * One pushed card. Renders the same content components the standalone routes
 * do, so a stacked timetable and `/stations/:op/:code/timetable` are the same
 * view in two frames.
 *
 * `open` is hardcoded true for the card's whole lifetime: the deck drives exits
 * through the animated close it registers with the slot, and the entry is
 * removed only once `onClose` reports the exit finished.
 */
export default function PaneCard({ pane, onClose }: PaneCardProps) {
  const slot = useDeckSlot()

  return (
    <SidePane
      open
      onClose={onClose}
      ariaLabel={pane.kind === 'timetable' ? 'Jadwal lengkap' : 'Detail stasiun'}
      header={() => (pane.kind === 'timetable'
        ? (
            <TimetablePaneHeader
              operator={pane.operator}
              code={pane.code}
              onBack={slot.onBack}
              onCloseAll={slot.onCloseAll}
            />
          )
        : (
            <StationPaneHeader
              operator={pane.operator}
              code={pane.code}
              onBack={slot.onBack}
              onClose={slot.onCloseAll ?? onClose}
            />
          ))}
    >
      {ready => (ready
        ? <PaneBody pane={pane} />
        : (
            <div className="px-4 pt-4 flex flex-col gap-2 max-w-3xl mx-auto">
              <div className="animate-pulse w-full h-32 bg-slate-200 rounded-lg" />
            </div>
          ))}
    </SidePane>
  )
}

function PaneBody({ pane }: { pane: PaneDescriptor }) {
  if (pane.kind === 'timetable') {
    return (
      // TimetableContent's section headers stick at `top-24`, the offset of the
      // standalone page's tall sticky header. In a card the scroll container is
      // the card body and there is nothing above them, so override it to 0 —
      // the standalone page keeps the 6rem fallback.
      <div style={{ '--timetable-sticky-top': '0px' } as React.CSSProperties}>
        <TimetableContent operator={pane.operator} code={pane.code} />
      </div>
    )
  }
  return <StationContent operator={pane.operator} code={pane.code} />
}

interface TimetablePaneHeaderProps {
  operator: string
  code: string
  onBack?: () => void
  onCloseAll?: () => void
}

// Mirrors the standalone page's header (name over a "Jadwal Lengkap" label), at
// card scale. No "open full page" affordance: the pushed timetable's URL is
// already the one in the address bar.
function TimetablePaneHeader({ operator, code, onBack, onCloseAll }: TimetablePaneHeaderProps) {
  const { header } = useStationHeader(operator, code)
  return (
    <div className="flex items-center justify-between gap-3">
      {onBack && (
        <button
          type="button"
          onClick={onBack}
          aria-label="Kembali"
          className="shrink-0 -ml-2 rounded-full flex items-center justify-center w-9 h-9 text-slate-700 hover:bg-slate-100 cursor-pointer"
        >
          <ArrowLeftIcon weight="bold" className="w-5 h-5" />
        </button>
      )}
      <div className="flex-1 min-w-0 flex flex-col">
        {header.isLoading
          ? (
              <div className="animate-pulse w-48 h-6 bg-slate-200 rounded-lg" />
            )
          : (
              <>
                <h2 className="font-bold text-xl truncate">{header.name}</h2>
                <span className="text-sm font-semibold text-gray-600">Jadwal Lengkap</span>
              </>
            )}
      </div>
      {onCloseAll && (
        <button
          type="button"
          onClick={onCloseAll}
          aria-label="Tutup detail stasiun"
          className="rounded-full flex items-center justify-center w-9 h-9 text-slate-700 hover:bg-slate-100 cursor-pointer"
        >
          <XIcon weight="bold" className="w-5 h-5" />
        </button>
      )}
    </div>
  )
}
