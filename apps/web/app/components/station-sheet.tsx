import { useMemo, useRef } from 'react'
import { usePaneStack } from './pane-stack/context'
import { XIcon, ArrowSquareOutIcon, ArrowLeftIcon } from '@phosphor-icons/react'
import DetailSurface from './detail-surface'
import ExitLink from './exit-link'
import LineRoundel from './line-roundel'
import StationContent, { useStationHeader } from './station-content'
import { sortLineKeysForDisplay } from '~/utils/lines'
import { useLines } from '~/hooks/use-lines'

interface StationSheetProps {
  operator: string | null
  code: string | null
  onClose: () => void
  onDismissStart?: () => void
  // Map-only: primes the map's pick-a-departure mode. Passed through to
  // StationContent's "Petunjuk Arah" button, composed with an animated close.
  onSelectDeparture?: () => void
  onIsolateLine?: (key: string) => void
  // Map-only: isolate a line on the map. Closes the sheet on the way, like the
  // departure action, so the isolate it just produced is actually visible.
}

export default function StationSheet({ operator, code, onClose, onDismissStart, onSelectDeparture, onIsolateLine }: StationSheetProps) {
  const open = !!(operator && code)

  // The surface unmounts the instant `open` flips false, so closing via the
  // parent's state would skip the exit animation. The animated close handle is
  // only surfaced to the header render prop — capture it so the departure
  // action can lerp the sheet away like the X button does.
  const animatedCloseRef = useRef<() => void>(() => {})
  const stack = usePaneStack()
  // useMemo, not an inline arrow: StationContent is memoized against snap-drag
  // re-renders and this prop participates in its shallow compare.
  const handleSelectDeparture = useMemo(() => (onSelectDeparture
    ? () => {
        onSelectDeparture()
        animatedCloseRef.current()
      }
    : undefined), [onSelectDeparture])

  /*
   * Same memo reasoning as above: StationContent compares this shallowly.
   *
   * Only closes the sheet when the line REPLACES it, which is the no-deck case.
   * With a deck the line is pushed OVER this station: closing would clear the
   * map's selection, which changes the deck's baseKey and collapses the very
   * card that was just pushed — no stack, and the line card disappears as fast
   * as it arrived.
   *
   * The animated close still has to run on the replacing path: the map clears
   * `selectedStation`, and a state change from outside flips `open` off, which
   * DetailSurface reports as a close without animating.
   */
  const handleIsolateLine = useMemo(() => (onIsolateLine
    ? (key: string) => {
        onIsolateLine(key)
        if (!stack?.canPush) animatedCloseRef.current()
      }
    : undefined), [onIsolateLine, stack?.canPush])

  return (
    <DetailSurface
      open={open}
      onClose={onClose}
      onDismissStart={onDismissStart}
      ariaLabel="Detail stasiun"
      header={(close) => {
        animatedCloseRef.current = close
        return operator && code
          ? <StationPaneHeader operator={operator} code={code} onClose={close} />
          : null
      }}
    >
      {ready => (ready && operator && code
        ? (
            <StationContent
              operator={operator}
              code={code}
              onSelectDeparture={handleSelectDeparture}
              onIsolateLine={handleIsolateLine}
            />
          )
        : (
            <div className="px-4 pt-4 flex flex-col gap-2 max-w-3xl mx-auto">
              <div className="animate-pulse w-full h-32 bg-slate-200 rounded-lg" />
            </div>
          ))}
    </DetailSurface>
  )
}

interface StationPaneHeaderProps {
  operator: string
  code: string
  onClose: () => void
  /** Present when this station is a card pushed over another one: shows a back
   * affordance, and `onClose` then means "dismiss the whole deck". */
  onBack?: () => void
}

// Exported so a station pushed onto the pane stack gets the same header as the
// base card rather than a near-copy of it.
export function StationPaneHeader({ operator, code, onClose, onBack }: StationPaneHeaderProps) {
  const { lines: resolveLines } = useLines()
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
      <div className="flex-1 min-w-0 flex flex-col gap-1">
        {header.isLoading
          ? (
              <div className="animate-pulse w-48 h-6 bg-slate-200 rounded-lg" />
            )
          : (
              <>
                {header.lines.length > 0 && (
                  <ul className="flex flex-row gap-1 flex-wrap">
                    {resolveLines(sortLineKeysForDisplay(header.lines, operator ?? undefined)).map(line => (
                      <li key={line.lineCode}>
                        <LineRoundel size="SM" code={line.lineCode} color={line.colorCode} operator={operator ?? undefined} />
                        <span className="sr-only">{line.name}</span>
                      </li>
                    ))}
                  </ul>
                )}
                <h2 className="font-bold text-xl truncate">{header.name}</h2>
              </>
            )}
      </div>
      <ExitLink
        to={`/stations/${operator}/${code}`}
        aria-label="Buka halaman stasiun lengkap"
        className="rounded-full flex items-center justify-center w-9 h-9 text-slate-700 hover:bg-slate-100"
      >
        <ArrowSquareOutIcon weight="bold" className="w-5 h-5" />
      </ExitLink>
      <button
        type="button"
        onClick={onClose}
        aria-label="Tutup detail stasiun"
        className="rounded-full flex items-center justify-center w-9 h-9 text-slate-700 hover:bg-slate-100 cursor-pointer"
      >
        <XIcon weight="bold" className="w-5 h-5" />
      </button>
    </div>
  )
}
