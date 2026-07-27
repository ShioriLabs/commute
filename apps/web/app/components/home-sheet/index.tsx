import { useEffect, useState } from 'react'
import { WarningIcon } from '@phosphor-icons/react'
import BottomSheet from '../bottom-sheet'
import StationContent from '../station-content'
import HubContent from '../hub-content'
import { StationSheetHeader } from '../station-sheet'
import { HubSheetHeader } from '../hub-sheet'
import SavedStationList from './saved-station-list'
import { useNetworkStatus } from '~/hooks/network'

// One row per saved station refreshes on this cadence. LineCard owns its own
// identical timer; here a single interval feeds every card so N saved stations
// don't mean N timers.
const CLOCK_TICK_MS = 10000

const SHEET_LABEL = {
  saved: 'Stasiun tersimpan',
  station: 'Detail stasiun',
  hub: 'Detail stasiun terintegrasi'
} as const

export type HomeSheetView =
  | { kind: 'saved' }
  | { kind: 'station', operator: string, code: string }
  | { kind: 'hub', slug: string }

interface Props {
  // Controlled by the host, which also drives the map camera from it. The stack
  // is only ever one deep: 'saved' is the root, station/hub sit on top of it.
  view: HomeSheetView
  onPopToRoot: () => void
  savedStationIds: string[]
  onSelectStation: (stationId: string) => void
}

function useSharedClock(): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), CLOCK_TICK_MS)
    return () => clearInterval(interval)
  }, [])
  return now
}

export default function HomeSheet({ view, onPopToRoot, savedStationIds, onSelectStation }: Props) {
  const now = useSharedClock()
  const networkStatus = useNetworkStatus()

  const renderHeader = (close: () => void) => {
    if (view.kind === 'station') {
      return <StationSheetHeader operator={view.operator} code={view.code} onClose={close} />
    }
    if (view.kind === 'hub') {
      return <HubSheetHeader slug={view.slug} onClose={close} />
    }
    return (
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-bold text-xl">Stasiun Tersimpan</h2>
        {savedStationIds.length > 0 && (
          <span className="text-sm text-slate-500 tabular-nums">
            {savedStationIds.length}
          </span>
        )}
      </div>
    )
  }

  const renderBody = (ready: boolean) => {
    if (!ready) {
      return (
        <div className="px-4 pt-4 flex flex-col gap-2 max-w-3xl mx-auto">
          <div className="animate-pulse w-full h-32 bg-slate-200 rounded-lg" />
        </div>
      )
    }
    if (view.kind === 'station') {
      return <StationContent operator={view.operator} code={view.code} />
    }
    if (view.kind === 'hub') {
      return <HubContent slug={view.slug} />
    }
    return (
      <>
        {networkStatus === 'OFFLINE' && (
          <div className="px-4 pt-3 max-w-3xl mx-auto">
            <div className="text-amber-950 bg-amber-100 flex flex-row gap-2 rounded-xl p-3 text-sm font-semibold">
              <WarningIcon weight="duotone" className="w-5 h-5 shrink-0" />
              Kamu sedang offline, data mungkin tidak up-to-date
            </div>
          </div>
        )}
        <SavedStationList
          stationIds={savedStationIds}
          now={now}
          onSelectStation={onSelectStation}
        />
      </>
    )
  }

  return (
    <BottomSheet
      // The saved list is the home screen: there is nothing to close it to.
      open
      floor="peek"
      onFloorDismiss={onPopToRoot}
      onClose={onPopToRoot}
      ariaLabel={SHEET_LABEL[view.kind]}
      header={renderHeader}
    >
      {renderBody}
    </BottomSheet>
  )
}
