import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import useSWR from 'swr'
import clsx from 'clsx'
import type { StandardResponse } from '@schema/response'
import type { Hub } from 'models/hub'
import type { Station } from 'models/stations'
import { fetcher } from 'utils/fetcher'
import { hexToRgb01 } from 'utils/colors'
import { parseStationId } from 'utils/saved-stations'
import { pointStationId, type HitResult } from '~/lib/map-renderer'
import { getUnservedStation } from '~/lib/unserved-stations'
import MapCanvas, { type MapCanvasHandle } from '~/components/map-canvas'
import { useMapManifest } from '~/components/map-canvas/use-map-manifest'
import HomeSheet, { type HomeSheetView } from '~/components/home-sheet'
import { PEEK_FRACTION } from '~/components/bottom-sheet'
import SearchStationsButton from '~/components/nav-buttons/search-stations'
import FareButton from '~/components/nav-buttons/fare'
import SettingsButton from '~/components/nav-buttons/settings'
import ListHome from './list-home'

interface Props {
  stationIds: string[]
}

export default function MapHome({ stationIds }: Props) {
  const { error: manifestError } = useMapManifest()
  const navigate = useNavigate()
  const canvasRef = useRef<MapCanvasHandle>(null)

  const [view, setView] = useState<HomeSheetView>({ kind: 'saved' })
  const [navVisible, setNavVisible] = useState(true)

  // Height the peeked sheet occupies. Measured after mount — this route is
  // server-rendered, so window isn't available during render.
  const [peekPx, setPeekPx] = useState(0)
  useLayoutEffect(() => {
    const update = () => setPeekPx(Math.round(window.innerHeight * PEEK_FRACTION))
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])

  // Hub tap targets carry a `HUB-…` point id that resolves to a slug. Same SWR
  // key as search and /map, so this is shared rather than a new request.
  const { data: hubs } = useSWR<StandardResponse<Hub[]>>(
    new URL('/hubs', import.meta.env.VITE_API_BASE_URL).href,
    fetcher
  )
  const hubSlugById = useMemo(() => {
    const index = new Map<string, string>()
    for (const hub of hubs?.data ?? []) index.set(hub.id, hub.slug)
    return index
  }, [hubs])
  const hubColorById = useMemo(() => {
    const index = new Map<string, [number, number, number]>()
    for (const hub of hubs?.data ?? []) {
      const color = hub.lines[0]?.colorCode
      if (color) index.set(hub.id, hexToRgb01(color))
    }
    return index
  }, [hubs])

  // Initial camera: frame the saved stations, falling back to the /map anchor
  // when nothing is saved or none of them are drawn on the schematic.
  const initialFocus = useMemo(
    () => ({ stationIds, anchorPointId: 'KCI-MRI', scale: 0.5 }),
    [stationIds]
  )

  const handleSelect = useCallback((hit: HitResult) => {
    if (hit.kind === 'hub') {
      const slug = hubSlugById.get(hit.point.id)
      if (!slug) {
        console.warn('Unknown hub point id:', hit.point.id)
        return
      }
      setView({ kind: 'hub', slug })
      const color = hubColorById.get(hit.point.id)
      if (color) canvasRef.current?.setSpotlightColor(color)
      return
    }
    const parsed = parseStationId(pointStationId(hit.point))
    if (!parsed) {
      console.warn('Unrecognized point id format:', hit.point.id)
      return
    }
    setView({ kind: 'station', operator: parsed.operator, code: parsed.code })
  }, [hubSlugById, hubColorById])

  // Tapping a saved row flies the map to it. A station with no point on the
  // schematic can't be flown to, so open its page instead.
  const handleSelectSavedStation = useCallback((stationId: string) => {
    const parsed = parseStationId(stationId)
    if (!parsed) return
    const focused = canvasRef.current?.focusStation(parsed.operator, parsed.code)
    if (!focused) {
      void navigate(`/stations/${parsed.operator}/${parsed.code}`)
      return
    }
    setView({ kind: 'station', operator: parsed.operator, code: parsed.code })
  }, [navigate])

  const popToRoot = useCallback(() => {
    setView({ kind: 'saved' })
    canvasRef.current?.clearSpotlight()
  }, [])

  // Re-tint the halo once the selected station's line colour resolves. Same
  // SWR key as the sheet content, so it's already in flight.
  const selectedStation = view.kind === 'station' ? view : null
  const { data: spotlightStation } = useSWR<StandardResponse<Station>>(
    selectedStation && !getUnservedStation(selectedStation.operator, selectedStation.code)
      ? new URL(`/stations/${selectedStation.operator}/${selectedStation.code}`, import.meta.env.VITE_API_BASE_URL).href
      : null,
    fetcher
  )
  const spotlightColor = spotlightStation?.data?.lines?.[0]?.colorCode
  const selectedStationId = selectedStation
    ? `${selectedStation.operator}-${selectedStation.code}`
    : null
  useEffect(() => {
    if (!selectedStationId || !spotlightColor) return
    canvasRef.current?.setSpotlightColor(hexToRgb01(spotlightColor), selectedStationId)
  }, [selectedStationId, spotlightColor])

  // The map is decoration on top of the thing people came for. If it can't
  // load, fall back to the list home silently — no banner, no retry. Announcing
  // a failed decoration would interrupt someone checking their train.
  if (manifestError) {
    return <ListHome stationIds={stationIds} />
  }

  return (
    <main className="fixed inset-0 bg-white overflow-hidden">
      <MapCanvas
        ref={canvasRef}
        ariaLabel="Peta integrasi transportasi umum Jakarta"
        bottomInset={peekPx}
        initialFocus={initialFocus}
        onSelect={handleSelect}
        onEmptyTap={() => setNavVisible(v => !v)}
        onEmptyTapReverted={() => setNavVisible(v => !v)}
        onInteractionStart={() => setNavVisible(false)}
      />

      {/* Sits below the sheet's z-30 so expanding the sheet slides over it. */}
      <nav
        aria-label="Navigasi utama"
        className={clsx(
          'absolute inset-x-0 z-20 transition-opacity duration-200',
          navVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'
        )}
        style={{ bottom: peekPx + 12 }}
      >
        <div className="w-full max-w-3xl mx-auto flex gap-2 px-4 overflow-x-auto no-scrollbar">
          <SearchStationsButton size="compact" />
          <FareButton size="compact" />
          <SettingsButton size="compact" />
        </div>
      </nav>

      <HomeSheet
        view={view}
        onPopToRoot={popToRoot}
        savedStationIds={stationIds}
        onSelectStation={handleSelectSavedStation}
      />
    </main>
  )
}
