import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useNavigationType, useSearchParams } from 'react-router'
import { XIcon, InfoIcon, CornersInIcon } from '@phosphor-icons/react'
import useSWR from 'swr'
import clsx from 'clsx'
import type { StandardResponse } from '@schema/response'
import type { Hub } from 'models/hub'
import type { Station } from 'models/stations'
import { fetcher } from 'utils/fetcher'
import { hexToRgb01 } from 'utils/colors'
import { pointStationId, type HitResult, type Point, type PointsManifest, type Transform } from '../lib/map-renderer'
import { getUnservedStation } from '../lib/unserved-stations'
import { AuthorOverlay, handleAuthorTap } from '../components/map-author'
import MapCanvas, { type MapCanvasHandle } from '../components/map-canvas'
import { useMapManifest } from '../components/map-canvas/use-map-manifest'
import StationSheet from '../components/station-sheet'
import HubSheet from '../components/hub-sheet'
import { PEEK_FRACTION } from '../components/bottom-sheet'
// Same URL import the canvas uses, so SWR dedupes: author mode needs the
// fetched points as the seed for its editable copy. See docs/fdtj-map-points.md.
import pointsUrl from '../data/points.json?url'

const AUTHOR_LS_KEY = 'fdtj-author-points-v1'
// Default radius for a newly placed author pill, in world units.
const AUTHOR_DEFAULT_R = 22

export function meta() {
  const title = 'Peta Integrasi - Commute'
  const description = 'Cek peta integrasi KRL, MRT, LRT, dan Transjakarta se-Jabodetabek, kagak pake ribet.'
  const image = 'https://commute.shiorilabs.id/img/og-map.png'
  return [
    { title },
    { name: 'theme-color', content: '#FFFFFF' },
    { name: 'description', content: description },
    { property: 'og:title', content: title },
    { property: 'og:description', content: description },
    { property: 'og:image', content: image },
    { name: 'twitter:title', content: title },
    { name: 'twitter:description', content: description },
    { name: 'twitter:image', content: image }
  ]
}

export default function MapPage() {
  const { manifest, error } = useMapManifest()
  const { data: pointsManifest } = useSWR<PointsManifest>(
    pointsUrl,
    (url: string) => fetch(url).then(r => r.json())
  )
  // Hubs power the map's hub tap targets: a `HUB-…` point id resolves to a hub
  // slug to open the HubSheet. Fetched once here (shared with search via SWR's
  // cache keyed by URL).
  const { data: hubs } = useSWR<StandardResponse<Hub[]>>(
    new URL('/hubs', import.meta.env.VITE_API_BASE_URL).href,
    fetcher
  )
  const hubSlugById = useMemo(() => {
    const index = new Map<string, string>()
    for (const hub of hubs?.data ?? []) index.set(hub.id, hub.slug)
    return index
  }, [hubs])
  // Spotlight halo color per hub, resolvable synchronously at tap time (the
  // hubs list is already loaded; stations need a fetch — see the effect below).
  const hubColorById = useMemo(() => {
    const index = new Map<string, [number, number, number]>()
    for (const hub of hubs?.data ?? []) {
      const color = hub.lines[0]?.colorCode
      if (color) index.set(hub.id, hexToRgb01(color))
    }
    return index
  }, [hubs])

  const [searchParams] = useSearchParams()
  const debugHitboxes = import.meta.env.DEV && searchParams.get('debug') === 'hitboxes'
  const authorMode = import.meta.env.DEV && searchParams.get('author') === '1'

  const navigate = useNavigate()
  const navigationType = useNavigationType()
  const handleBackButton = useCallback(() => {
    if (navigationType === 'POP') {
      navigate('/')
    } else {
      history.back()
    }
  }, [navigationType, navigate])

  const canvasRef = useRef<MapCanvasHandle>(null)
  const viewportRef = useRef<HTMLDivElement>(null)

  // Chrome (top bar) auto-hides during map interaction and reappears when the
  // user taps empty space. Author mode toolbar / edit panel are unaffected.
  const [chromeVisible, setChromeVisible] = useState(true)
  const [attributionOpen, setAttributionOpen] = useState(false)
  const [isZoomedIn, setIsZoomedIn] = useState(false)
  // Height the peeked station/hub sheet will occupy, so selections fly into
  // the gap above it. Measured after mount — this route is server-rendered.
  const [peekPx, setPeekPx] = useState(0)
  useLayoutEffect(() => {
    const update = () => setPeekPx(Math.round(window.innerHeight * PEEK_FRACTION))
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])
  // Currently selected station for the bottom sheet. Pill IDs are formatted
  // `OPERATOR-CODE` (e.g. KCI-MRI); split on first hyphen.
  const [selectedStation, setSelectedStation] = useState<{ operator: string, code: string } | null>(null)
  const [selectedHubSlug, setSelectedHubSlug] = useState<string | null>(null)

  // ── Author mode ──────────────────────────────────────────────────────────
  // Editable copy of the points, persisted to localStorage. Passed to the
  // canvas as controlled `points` so the renderer draws the edits live.
  const [workingPoints, setWorkingPoints] = useState<Point[]>([])
  const workingPointsRef = useRef<Point[]>([])
  workingPointsRef.current = workingPoints
  const [editingId, setEditingId] = useState<string | null>(null)
  // The live transform, mirrored into state so the floating edit panel can
  // follow pan/zoom. Only subscribed in author mode — it re-renders per frame.
  const [renderedTransform, setRenderedTransform] = useState<Transform>({ tx: 0, ty: 0, scale: 1 })

  const authorHydratedRef = useRef(false)
  useEffect(() => {
    if (!authorMode || authorHydratedRef.current) return
    try {
      const raw = window.localStorage.getItem(AUTHOR_LS_KEY)
      if (raw) {
        setWorkingPoints(JSON.parse(raw) as Point[])
        authorHydratedRef.current = true
        return
      }
    } catch (e) {
      console.warn('[author] localStorage read failed', e)
    }
    if (pointsManifest) {
      setWorkingPoints(pointsManifest.points)
      authorHydratedRef.current = true
    }
  }, [authorMode, pointsManifest])

  useEffect(() => {
    if (!authorMode || !authorHydratedRef.current) return
    try {
      window.localStorage.setItem(AUTHOR_LS_KEY, JSON.stringify(workingPoints))
    } catch (e) {
      console.warn('[author] localStorage write failed', e)
    }
  }, [authorMode, workingPoints])

  const handleAuthorTapIntercept = useCallback((tap: {
    worldX: number
    worldY: number
    slopWorld: number
    shift: boolean
  }) => {
    handleAuthorTap({
      ...tap,
      pointsRef: workingPointsRef,
      editingId,
      setWorkingPoints,
      setEditingId,
      defaultR: AUTHOR_DEFAULT_R
    })
    return true
  }, [editingId])

  // ── Selection ────────────────────────────────────────────────────────────
  const handleSelect = useCallback((hit: HitResult) => {
    setAttributionOpen(false)
    if (hit.kind === 'hub') {
      // Hub region tapped (no member pill won). Resolve `HUB-…` id → slug.
      const slug = hubSlugById.get(hit.point.id)
      if (!slug) {
        console.warn('Unknown hub point id:', hit.point.id)
        return
      }
      setSelectedStation(null)
      setSelectedHubSlug(slug)
      const color = hubColorById.get(hit.point.id)
      if (color) canvasRef.current?.setSpotlightColor(color)
      return
    }
    // Pill IDs look like "KCI-MRI". Split on first hyphen so codes containing
    // further hyphens still parse correctly. Read the station via
    // pointStationId: a halte drawn twice has one extra dot whose id is
    // suffixed (`TJ-H00037C-b`) and whose `station` holds the real code.
    const stationId = pointStationId(hit.point)
    const dash = stationId.indexOf('-')
    if (dash <= 0) {
      console.warn('Unrecognized point id format:', hit.point.id)
      return
    }
    setSelectedHubSlug(null)
    setSelectedStation({ operator: stationId.slice(0, dash), code: stationId.slice(dash + 1) })
  }, [hubSlugById, hubColorById])

  // Resolve the selected station's line color for the spotlight halo. Same
  // URL key as StationSheet's content, so SWR dedupes — no extra request. The
  // halo starts neutral and re-tints when this resolves.
  const { data: spotlightStation } = useSWR<StandardResponse<Station>>(
    selectedStation && !getUnservedStation(selectedStation.operator, selectedStation.code)
      ? new URL(`/stations/${selectedStation.operator}/${selectedStation.code}`, import.meta.env.VITE_API_BASE_URL).href
      : null,
    fetcher
  )
  useEffect(() => {
    if (!selectedStation) return
    const color = spotlightStation?.data?.lines?.[0]?.colorCode
    if (!color) return
    canvasRef.current?.setSpotlightColor(
      hexToRgb01(color),
      `${selectedStation.operator}-${selectedStation.code}`
    )
  }, [spotlightStation, selectedStation])

  // Backstop: if the selection is cleared through any path that didn't go
  // through a sheet dismiss (the sheets' onDismissStart handles the common
  // case as soon as the close starts), fade the spotlight out.
  useEffect(() => {
    if (selectedStation || selectedHubSlug) return
    canvasRef.current?.clearSpotlight()
  }, [selectedStation, selectedHubSlug])

  if (error) {
    return (
      <main className="w-screen h-screen flex items-center justify-center flex-col p-4 bg-white" aria-live="polite">
        <p className="text-center text-lg">Gagal memuat peta integrasi.</p>
        <Link to="/" className="mt-6 px-4 py-2 rounded-lg bg-rose-100 text-pink-800 font-semibold">
          Kembali ke Beranda
        </Link>
      </main>
    )
  }

  if (!manifest) {
    return (
      <main className="w-screen h-screen flex items-center justify-center bg-white" aria-live="assertive">
        <div className="rounded-full border-4 border-slate-600 border-t-transparent w-12 h-12 animate-spin" aria-label="Memuat peta..." />
      </main>
    )
  }

  return (
    <main className="fixed inset-0 bg-white overflow-hidden">
      <MapCanvas
        ref={canvasRef}
        viewportRef={viewportRef}
        ariaLabel="Peta integrasi transportasi umum Jakarta"
        bottomInset={peekPx}
        initialFocus={{ anchorPointId: 'KCI-MRI', scale: 0.5 }}
        onSelect={handleSelect}
        onEmptyTap={() => {
          setAttributionOpen(false)
          setChromeVisible(v => !v)
        }}
        onEmptyTapReverted={() => setChromeVisible(v => !v)}
        onInteractionStart={() => setChromeVisible(false)}
        onZoomChange={setIsZoomedIn}
        // In author mode, always show hitboxes so the placed pills are visible.
        debugHitboxes={debugHitboxes || authorMode}
        disableDoubleTap={authorMode}
        points={authorMode ? workingPoints : undefined}
        onTapWorld={authorMode ? handleAuthorTapIntercept : undefined}
        onFrame={authorMode ? setRenderedTransform : undefined}
      />

      <div
        className={clsx(
          'absolute inset-x-0 top-0 z-10 bg-white/50 backdrop-blur border-b-2 border-b-gray-50/20 transition-opacity duration-200',
          chromeVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'
        )}
      >
        <div className="p-8 pb-4 pr-20 max-w-3xl mx-auto pointer-events-auto flex flex-col">
          <h1 className="font-bold text-xl">Peta Integrasi</h1>
        </div>
      </div>

      <button
        type="button"
        onClick={handleBackButton}
        aria-label="Tutup halaman peta"
        className="absolute top-4 right-4 z-20 rounded-full bg-white/90 backdrop-blur shadow-lg w-11 h-11 flex items-center justify-center cursor-pointer"
      >
        <XIcon weight="bold" className="w-6 h-6 text-slate-700" />
      </button>

      <button
        type="button"
        onClick={() => canvasRef.current?.flyToFit()}
        aria-label="Kembali ke tampilan penuh"
        tabIndex={isZoomedIn ? 0 : -1}
        className={clsx(
          'absolute bottom-4 right-16 z-20 rounded-full bg-white/90 backdrop-blur shadow-lg w-10 h-10 flex items-center justify-center cursor-pointer transition-opacity duration-200',
          isZoomedIn ? 'opacity-100' : 'opacity-0 pointer-events-none'
        )}
      >
        <CornersInIcon weight="bold" className="w-5 h-5 text-slate-700" />
      </button>

      <button
        type="button"
        onClick={() => setAttributionOpen(o => !o)}
        aria-label="Lihat atribusi peta"
        aria-expanded={attributionOpen}
        className="absolute bottom-4 right-4 z-20 rounded-full bg-white/90 backdrop-blur shadow-lg w-10 h-10 flex items-center justify-center cursor-pointer"
      >
        <InfoIcon weight="bold" className="w-5 h-5 text-slate-700" />
      </button>

      {attributionOpen && (
        <div
          role="dialog"
          aria-label="Atribusi peta"
          className="absolute bottom-16 right-4 z-20 bg-white rounded-lg shadow-xl border border-slate-200 p-4 max-w-xs text-sm text-slate-700"
          onPointerDown={e => e.stopPropagation()}
        >
          <div className="font-semibold mb-1">Peta Integrasi Jakarta</div>
          <div className="text-xs text-slate-600">
            © Forum Diskusi Transportasi Jakarta (FDTJ)
          </div>
          <div className="text-xs text-slate-500 mt-1">
            Versi
            {' '}
            {manifest.version}
          </div>
        </div>
      )}

      {authorMode && (
        <AuthorOverlay
          viewportRef={viewportRef}
          points={workingPoints}
          editingId={editingId}
          rendered={renderedTransform}
          onChange={setWorkingPoints}
          onSetEditingId={setEditingId}
          onExport={() => {
            const json = JSON.stringify({ version: manifest.version, points: workingPoints }, null, 2)
            const blob = new Blob([json], { type: 'application/json' })
            const url = URL.createObjectURL(blob)
            const a = document.createElement('a')
            a.href = url
            a.download = 'points.json'
            a.click()
            URL.revokeObjectURL(url)
          }}
          onClear={() => {
            if (window.confirm('Clear all points? This cannot be undone (Export first if you want a backup).')) {
              setWorkingPoints([])
              setEditingId(null)
            }
          }}
        />
      )}

      <StationSheet
        operator={selectedStation?.operator ?? null}
        code={selectedStation?.code ?? null}
        onClose={() => setSelectedStation(null)}
        // Start the spotlight exit as soon as the dismiss begins — unless the
        // sheet is closing because the user switched to a hub, whose
        // spotlight is already animating in.
        onDismissStart={() => { if (!selectedHubSlug) canvasRef.current?.clearSpotlight() }}
      />

      <HubSheet
        slug={selectedHubSlug}
        onClose={() => setSelectedHubSlug(null)}
        onDismissStart={() => { if (!selectedStation) canvasRef.current?.clearSpotlight() }}
      />
    </main>
  )
}
