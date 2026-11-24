import { useMemo, useRef } from 'react'
import { XIcon, ArrowSquareOutIcon } from '@phosphor-icons/react'
import { HUB_KIND_LABEL } from '@commute/constants'
import type { Hub } from '@commute/schemas'
import DetailSurface from './detail-surface'
import ExitLink from './exit-link'
import HubContent, { HubPlaceContent, useHub } from './hub-content'
import { HubMemberSummary, HubPlaceTitle, type HubSelection, useHubSelection } from './hub-switcher'
import { usePaneStack } from './pane-stack/context'
import { isPlaceHub } from '~/utils/hub-members'

interface HubSheetProps {
  slug: string | null
  /** Station id to open on: the Arah dot the rider tapped on the map. */
  initialMemberId?: string | null
  onClose: () => void
  onDismissStart?: () => void
  // Map-only, as on StationSheet: a place hub's body IS a station's content, so
  // its "Petunjuk Arah" and line-isolate actions behave exactly like there. The
  // map has no selectedStation while a hub is open, so the departure action is
  // told which member it is for.
  onSelectDeparture?: (stationId: string) => void
  onIsolateLine?: (key: string) => void
}

export default function HubSheet({ slug, initialMemberId, onClose, onDismissStart, onSelectDeparture, onIsolateLine }: HubSheetProps) {
  const open = !!slug
  const { hub } = useHub(slug)
  const place = hub && isPlaceHub(hub.kind) ? hub : null
  // Lives here, not in the header or body: the DetailSurface renders them as
  // two separate trees, and both must show the same member.
  const selection = useHubSelection(place, initialMemberId)

  // Same reasoning as StationSheet: the surface unmounts the instant `open`
  // flips, so the departure action has to drive the animated close itself.
  const animatedCloseRef = useRef<() => void>(() => {})
  const stack = usePaneStack()
  const memberId = selection?.member.id
  const handleSelectDeparture = useMemo(() => (onSelectDeparture && memberId
    ? () => {
        onSelectDeparture(memberId)
        animatedCloseRef.current()
      }
    : undefined), [onSelectDeparture, memberId])
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
      ariaLabel="Detail stasiun terintegrasi"
      header={(close) => {
        animatedCloseRef.current = close
        return slug
          ? <SheetHeader slug={slug} hub={hub} selection={selection} onClose={close} />
          : null
      }}
    >
      {(ready) => {
        if (!ready || !hub) {
          return (
            <div className="px-4 pt-4 flex flex-col gap-2 max-w-3xl mx-auto">
              <div className="animate-pulse w-full h-32 bg-slate-200 rounded-lg" />
            </div>
          )
        }
        if (selection) {
          return (
            <HubPlaceContent
              selection={selection}
              onSelectDeparture={handleSelectDeparture}
              onIsolateLine={handleIsolateLine}
            />
          )
        }
        return <HubContent hub={hub} />
      }}
    </DetailSurface>
  )
}

function SheetHeader({ slug, hub, selection, onClose }: { slug: string, hub: Hub | null, selection: HubSelection | null, onClose: () => void }) {
  // The full page opens on the same side the sheet is showing.
  const fullPage = selection ? `/hubs/${slug}?m=${encodeURIComponent(selection.member.id)}` : `/hubs/${slug}`
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex-1 min-w-0">
          {!hub
            ? (
                <div className="animate-pulse w-48 h-6 bg-slate-200 rounded-lg" />
              )
            : selection
              ? <HubPlaceTitle hub={hub} selection={selection} as="h2" />
              : (
                  <>
                    <h2 className="font-bold text-xl truncate">{hub.name}</h2>
                    <span className="text-sm font-semibold text-gray-600">{HUB_KIND_LABEL[hub.kind]}</span>
                  </>
                )}
        </div>
        <ExitLink
          to={fullPage}
          aria-label="Buka halaman stasiun terintegrasi lengkap"
          className="rounded-full flex items-center justify-center w-9 h-9 shrink-0 text-slate-700 hover:bg-slate-100"
        >
          <ArrowSquareOutIcon weight="bold" className="w-5 h-5" />
        </ExitLink>
        <button
          type="button"
          onClick={onClose}
          aria-label="Tutup detail stasiun terintegrasi"
          className="rounded-full flex items-center justify-center w-9 h-9 shrink-0 text-slate-700 hover:bg-slate-100 cursor-pointer"
        >
          <XIcon weight="bold" className="w-5 h-5" />
        </button>
      </div>
      {selection && <HubMemberSummary selection={selection} />}
    </div>
  )
}
