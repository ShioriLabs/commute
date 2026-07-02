import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useNavigationType, useSearchParams } from 'react-router'
import { XIcon, InfoIcon, CornersInIcon } from '@phosphor-icons/react'
import useSWR from 'swr'
import type { StandardResponse } from '@schema/response'
import type { Hub } from 'models/hub'
import type { Station } from 'models/stations'
import { fetcher } from 'utils/fetcher'
import { hexToRgb01 } from 'utils/colors'
import { haptic } from 'utils/haptics'
import {
  createRenderer,
  hitTest,
  pickTier,
  SCRIM_MAX_ALPHA,
  type Manifest,
  type Point,
  type PointsManifest,
  type Renderer,
  type SelectionOverlay,
  type Tier,
  type Transform
} from '../lib/map-renderer'
import { AuthorOverlay, handleAuthorTap } from '../components/map-author'
import StationSheet from '../components/station-sheet'
import HubSheet from '../components/hub-sheet'
import { PEEK_FRACTION } from '../components/bottom-sheet'

const TAP_MOVEMENT_THRESHOLD_CSS_PX = 8
const TOUCH_HIT_SLOP_CSS_PX = 12
const AUTHOR_LS_KEY = 'fdtj-author-points-v1'

// Lerp time constants (milliseconds). Lower = snappier, higher = floatier.
// Wheel zoom and end-of-gesture eased; active drag/pinch snap 1:1.
const LERP_TAU_MS = 80
// Inertia: pixels/ms of velocity at release decays exponentially with this tau.
const INERTIA_TAU_MS = 180
// Below this velocity (CSS px/ms) we stop the inertia loop.
const INERTIA_MIN_VELOCITY = 0.04
// Use the most recent N ms of pointer-move samples to estimate release velocity.
const VELOCITY_SAMPLE_WINDOW_MS = 80

// Selection spotlight animation durations.
const SPOTLIGHT_IN_MS = 350
const SPOTLIGHT_OUT_MS = 220
// Halo color before the selection's line color resolves (slate-500).
const SPOTLIGHT_NEUTRAL_COLOR: [number, number, number] = [0.39, 0.45, 0.55]
// Two taps within this window and radius count as a double-tap.
const DOUBLE_TAP_MS = 300
const DOUBLE_TAP_RADIUS_CSS_PX = 30

export function meta() {
  const title = 'Peta Integrasi - Commute'
  const description = 'Peta integrasi antarmoda KRL, MRT, LRT, dan Transjakarta di Jabodetabek'
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

const MAX_SCALE = 1.5
const WHEEL_ZOOM_INTENSITY = 0.0015

function clampTransform(
  t: Transform,
  viewportW: number,
  viewportH: number,
  mapW: number,
  mapH: number,
  minScale: number
): Transform {
  const scale = Math.max(minScale, Math.min(MAX_SCALE, t.scale))
  const scaledW = mapW * scale
  const scaledH = mapH * scale
  // If the map is smaller than the viewport on an axis, center it; otherwise
  // clamp so the map edge can't be dragged inside the viewport.
  const tx = scaledW <= viewportW
    ? (viewportW - scaledW) / 2
    : Math.min(0, Math.max(viewportW - scaledW, t.tx))
  const ty = scaledH <= viewportH
    ? (viewportH - scaledH) / 2
    : Math.min(0, Math.max(viewportH - scaledH, t.ty))
  return { tx, ty, scale }
}

export default function MapPage() {
  const { data: manifest, error } = useSWR<Manifest>(
    '/maps/fdtj/manifest.json',
    (url: string) => fetch(url).then(r => r.json())
  )
  const { data: pointsManifest } = useSWR<PointsManifest>(
    '/maps/fdtj/points.json',
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

  // Working set of points. In normal mode this mirrors the SWR-fetched
  // points.json; in author mode it's an editable copy persisted to
  // localStorage. The renderer always reads from this.
  const [workingPoints, setWorkingPoints] = useState<Point[]>([])
  const workingPointsRef = useRef<Point[]>([])
  workingPointsRef.current = workingPoints

  // Author-mode UI state: id of the pill currently being edited (newly placed
  // or selected). Floating input renders next to its world position.
  const [editingId, setEditingId] = useState<string | null>(null)
  // In author mode we re-render every frame so floating UI (the input next to
  // the editing pill) follows pan/zoom. In normal mode no React rerenders are
  // needed since the canvas owns its own draw loop.
  const [, setRenderTick] = useState(0)

  // Initial load: in author mode prefer localStorage, falling back to the
  // SWR-fetched points.json. In normal mode, just mirror points.json.
  const authorHydratedRef = useRef(false)
  useEffect(() => {
    if (authorMode) {
      if (authorHydratedRef.current) return
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
    } else {
      setWorkingPoints(pointsManifest?.points ?? [])
    }
  }, [authorMode, pointsManifest])

  // Author mode: persist every change.
  useEffect(() => {
    if (!authorMode || !authorHydratedRef.current) return
    try {
      window.localStorage.setItem(AUTHOR_LS_KEY, JSON.stringify(workingPoints))
    } catch (e) {
      console.warn('[author] localStorage write failed', e)
    }
  }, [authorMode, workingPoints])

  const viewportRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rendererRef = useRef<Renderer | null>(null)
  const dirtyRef = useRef(true)
  const rafRef = useRef<number>(0)
  const currentTierRef = useRef<Tier>(1)

  const [viewportSize, setViewportSize] = useState({ w: 0, h: 0 })

  // Chrome (top bar) auto-hides during map interaction and reappears when the
  // user taps empty space. Author mode toolbar / edit panel are unaffected.
  const [chromeVisible, setChromeVisible] = useState(true)
  const [attributionOpen, setAttributionOpen] = useState(false)
  // Currently selected station for the bottom sheet. Pill IDs are formatted
  // `OPERATOR-CODE` (e.g. KCI-MRI); split on first hyphen.
  const [selectedStation, setSelectedStation] = useState<{ operator: string, code: string } | null>(null)
  const [selectedHubSlug, setSelectedHubSlug] = useState<string | null>(null)

  // Two transforms: `target` is where we want to be; `rendered` is what we
  // currently draw. The rAF loop lerps rendered toward target each frame so
  // wheel zoom and end-of-gesture motion ease. During active drag/pinch we
  // snap rendered to target so the map tracks the finger 1:1.
  const targetRef = useRef<Transform>({ tx: 0, ty: 0, scale: 1 })
  const renderedRef = useRef<Transform>({ tx: 0, ty: 0, scale: 1 })
  // `transformRef` retains the existing name so non-render code (hit-test,
  // zoomAt anchor math) reads the *target* — the user's intent, not the
  // currently-rendered frame.
  const transformRef = targetRef
  const gestureActiveRef = useRef(false)

  // Track pointer state without re-rendering.
  const pointersRef = useRef<Map<number, { x: number, y: number }>>(new Map())
  const pinchStartRef = useRef<{ dist: number, scale: number, centerX: number, centerY: number } | null>(null)
  // Per-pointer tap-tracking: captures pointerdown position and the maximum
  // distance the pointer has moved during the gesture, so pointerup can
  // distinguish a tap from a drag.
  const tapTrackRef = useRef<Map<number, {
    startX: number
    startY: number
    maxDist: number
    pointerType: string
  }>>(new Map())
  // Per-pointer velocity sample log for flick inertia.
  const velocitySamplesRef = useRef<Map<number, Array<{ t: number, x: number, y: number }>>>(new Map())
  // Active inertia (decaying pan velocity in CSS px/ms).
  const inertiaRef = useRef<{ vx: number, vy: number } | null>(null)
  // Timestamp of last animation tick; used for frame-rate-independent lerp.
  const lastFrameTimeRef = useRef<number>(0)

  // Selection spotlight: scrim + halo around the selected pill, animated in
  // the rAF tick. `lastScrim`/`lastRing` mirror the values drawn on the most
  // recent frame so phase changes (switch, exit) can start from the current
  // visual state instead of jumping.
  const spotlightRef = useRef<{
    point: Point
    color: [number, number, number]
    phase: 'in' | 'hold' | 'out'
    phaseStart: number
    scrimFrom: number
    ringFrom: number
    lastScrim: number
    lastRing: number
  } | null>(null)
  // Eased camera flight (selection centering, double-tap zoom, recenter).
  // While active it writes both target and rendered so the plain lerp is inert.
  const flyToRef = useRef<{ from: Transform, to: Transform, start: number, duration: number } | null>(null)
  // Previous clean tap, for double-tap detection.
  const lastTapRef = useRef<{ t: number, x: number, y: number, wasEmpty: boolean } | null>(null)
  // Recenter button visibility; ref mirrors state so the tick only calls
  // setState when the value actually flips.
  const [isZoomedIn, setIsZoomedIn] = useState(false)
  const isZoomedInRef = useRef(false)
  // Tap ripples (screen-space DOM overlay).
  const [ripples, setRipples] = useState<Array<{ id: number, x: number, y: number }>>([])
  const rippleIdRef = useRef(0)

  // Resolve the selected station's line color for the spotlight halo. Same
  // URL key as StationSheet's content, so SWR dedupes — no extra request. The
  // halo starts neutral and re-tints when this resolves.
  const { data: spotlightStation } = useSWR<StandardResponse<Station>>(
    selectedStation
      ? new URL(`/stations/${selectedStation.operator}/${selectedStation.code}`, import.meta.env.VITE_API_BASE_URL).href
      : null,
    fetcher
  )
  useEffect(() => {
    const spot = spotlightRef.current
    if (!spot || !selectedStation) return
    const color = spotlightStation?.data?.lines?.[0]?.colorCode
    if (!color) return
    if (spot.point.id !== `${selectedStation.operator}-${selectedStation.code}`) return
    spot.color = hexToRgb01(color)
    dirtyRef.current = true
  }, [spotlightStation, selectedStation])

  // Fade the spotlight out from whatever it currently shows. No-ops when
  // there's no spotlight or it's already exiting.
  const beginSpotlightExit = useCallback(() => {
    const spot = spotlightRef.current
    if (!spot || spot.phase === 'out') return
    spot.phase = 'out'
    spot.phaseStart = performance.now()
    spot.scrimFrom = spot.lastScrim
    spot.ringFrom = spot.lastRing
    dirtyRef.current = true
  }, [])

  // Backstop: if the selection is cleared through any path that didn't go
  // through a sheet dismiss (the sheets' onDismissStart handles the common
  // case as soon as the close starts), fade the spotlight out.
  useEffect(() => {
    if (selectedStation || selectedHubSlug) return
    beginSpotlightExit()
  }, [selectedStation, selectedHubSlug, beginSpotlightExit])

  useLayoutEffect(() => {
    if (!viewportRef.current) return
    const el = viewportRef.current
    const update = () => {
      const rect = el.getBoundingClientRect()
      setViewportSize({ w: rect.width, h: rect.height })
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [manifest])

  // Compute the minimum scale that fits the whole map into the viewport (with a small bleed).
  const mapW = manifest?.viewBox[2] ?? 0
  const mapH = manifest?.viewBox[3] ?? 0
  // Use max(viewport/map) so the map's shorter dimension fills the viewport
  // at minimum zoom. The longer dimension overflows and is pannable, but no
  // letterbox bars appear.
  const minScale = (viewportSize.w && viewportSize.h && mapW && mapH)
    ? Math.max(viewportSize.w / mapW, viewportSize.h / mapH)
    : 0.01

  // On first measurement, center the map at 50% zoom on the KCI-MRI station.
  // If points.json hasn't loaded yet, a *provisional* fit-to-viewport center
  // is applied and the effect re-runs when points arrive to center properly —
  // unless the user has already moved the map, in which case their position
  // wins and we latch where they are.
  const didCenterRef = useRef(false)
  const provisionalCenterRef = useRef<Transform | null>(null)
  useEffect(() => {
    if (didCenterRef.current) return
    if (!viewportSize.w || !viewportSize.h || !mapW || !mapH) return

    const provisional = provisionalCenterRef.current
    const current = targetRef.current
    if (provisional && (
      current.tx !== provisional.tx
      || current.ty !== provisional.ty
      || current.scale !== provisional.scale
    )) {
      didCenterRef.current = true
      return
    }

    const fitScale = Math.max(viewportSize.w / mapW, viewportSize.h / mapH)
    const initialScale = Math.max(fitScale, 0.5)

    const anchor = pointsManifest?.points.find(p => p.id === 'KCI-MRI')
    const anchorX = anchor ? (anchor.ax + anchor.bx) / 2 : mapW / 2
    const anchorY = anchor ? (anchor.ay + anchor.by) / 2 : mapH / 2

    // Place (anchorX, anchorY) under the viewport center.
    const tx = viewportSize.w / 2 - anchorX * initialScale
    const ty = viewportSize.h / 2 - anchorY * initialScale
    const initial = clampTransform(
      { tx, ty, scale: initialScale },
      viewportSize.w, viewportSize.h, mapW, mapH, fitScale
    )
    targetRef.current = initial
    renderedRef.current = initial
    dirtyRef.current = true
    provisionalCenterRef.current = initial
    // Latch once the anchor was used — or points have loaded and it doesn't
    // exist, in which case the fallback is as good as it gets.
    if (anchor || pointsManifest) didCenterRef.current = true
  }, [viewportSize.w, viewportSize.h, mapW, mapH, pointsManifest])

  // Initialize renderer once the manifest is loaded.
  useEffect(() => {
    if (!manifest || !canvasRef.current) return
    const renderer = createRenderer(
      canvasRef.current,
      manifest,
      '/maps/fdtj/',
      () => { dirtyRef.current = true }
    )
    rendererRef.current = renderer
    const dpr = window.devicePixelRatio || 1
    const rect = canvasRef.current.getBoundingClientRect()
    if (rect.width && rect.height) {
      renderer.resize(rect.width, rect.height, dpr)
    }
    dirtyRef.current = true
    return () => {
      renderer.dispose()
      rendererRef.current = null
    }
  }, [manifest])

  // Push points + debug flag to the renderer. Depends on manifest so it re-fires
  // when the renderer is (re-)created after manifest load — covers the case
  // where points load before the renderer exists.
  useEffect(() => {
    if (!rendererRef.current) return
    rendererRef.current.setPoints(workingPoints)
    // In author mode, always show hitboxes so the placed pills are visible.
    rendererRef.current.setDebugHitboxes(debugHitboxes || authorMode)
  }, [workingPoints, debugHitboxes, authorMode, manifest])

  // Resize the renderer's backing store when the viewport changes.
  useEffect(() => {
    if (!rendererRef.current) return
    if (!viewportSize.w || !viewportSize.h) return
    rendererRef.current.resize(viewportSize.w, viewportSize.h, window.devicePixelRatio || 1)
    dirtyRef.current = true
  }, [viewportSize.w, viewportSize.h])

  // Watch for DPR changes (browser zoom).
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    let mql = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`)
    const handler = () => {
      const dpr = window.devicePixelRatio || 1
      if (rendererRef.current && viewportSize.w && viewportSize.h) {
        rendererRef.current.resize(viewportSize.w, viewportSize.h, dpr)
        dirtyRef.current = true
      }
      mql.removeEventListener('change', handler)
      mql = window.matchMedia(`(resolution: ${dpr}dppx)`)
      mql.addEventListener('change', handler)
    }
    mql.addEventListener('change', handler)
    return () => mql.removeEventListener('change', handler)
  }, [viewportSize.w, viewportSize.h])

  // No-op placeholder: transforms now live in refs and are marked dirty
  // wherever they're written.

  // requestAnimationFrame loop: integrates inertia, lerps rendered toward
  // target, and draws when anything moved (or dirty was set externally).
  useEffect(() => {
    let stopped = false
    const tick = (now: number) => {
      if (stopped) return
      const renderer = rendererRef.current
      if (!renderer || !viewportSize.w || !viewportSize.h) {
        rafRef.current = requestAnimationFrame(tick)
        return
      }
      const last = lastFrameTimeRef.current || now
      const dt = Math.min(64, now - last) // clamp to 64ms to avoid huge jumps after a stall
      lastFrameTimeRef.current = now

      // Eased camera flight: drives both target and rendered so the plain
      // lerp below stays inert for its duration. Canceled by pointerdown and
      // wheel (like inertia), so it never fights a gesture.
      const fly = flyToRef.current
      if (fly && !gestureActiveRef.current) {
        const p = Math.min(1, (now - fly.start) / fly.duration)
        const e = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2 // easeInOutCubic
        const mixed = {
          tx: fly.from.tx + (fly.to.tx - fly.from.tx) * e,
          ty: fly.from.ty + (fly.to.ty - fly.from.ty) * e,
          scale: fly.from.scale + (fly.to.scale - fly.from.scale) * e
        }
        targetRef.current = mixed
        renderedRef.current = mixed
        if (p >= 1) flyToRef.current = null
        dirtyRef.current = true
      }

      // Inertia: decay velocity, add to target.
      const inertia = inertiaRef.current
      if (inertia && !gestureActiveRef.current) {
        const decay = Math.exp(-dt / INERTIA_TAU_MS)
        const target = targetRef.current
        // Add average velocity over this frame (trapezoidal).
        const avgVx = inertia.vx * (1 + decay) / 2
        const avgVy = inertia.vy * (1 + decay) / 2
        targetRef.current = clampTransform(
          { tx: target.tx + avgVx * dt, ty: target.ty + avgVy * dt, scale: target.scale },
          viewportSize.w, viewportSize.h, mapW, mapH, minScale
        )
        inertia.vx *= decay
        inertia.vy *= decay
        if (Math.hypot(inertia.vx, inertia.vy) < INERTIA_MIN_VELOCITY) {
          inertiaRef.current = null
        }
        dirtyRef.current = true
      }

      // Lerp rendered toward target. During an active drag/pinch, snap so the
      // map tracks the finger 1:1; otherwise ease frame-rate-independently.
      const target = targetRef.current
      const rendered = renderedRef.current
      const dtx = target.tx - rendered.tx
      const dty = target.ty - rendered.ty
      const dscale = target.scale - rendered.scale
      const moved = Math.abs(dtx) + Math.abs(dty) > 0.05 || Math.abs(dscale) > 1e-5
      if (moved) {
        if (gestureActiveRef.current) {
          renderedRef.current = target
        } else {
          const alpha = 1 - Math.exp(-dt / LERP_TAU_MS)
          renderedRef.current = {
            tx: rendered.tx + dtx * alpha,
            ty: rendered.ty + dty * alpha,
            scale: rendered.scale + dscale * alpha
          }
        }
        dirtyRef.current = true
      }

      // Selection spotlight: animate in/out phases here (forcing redraw while
      // they run); in the steady `hold` phase the overlay is drawn on any
      // dirty frame — tracking pan/zoom — without forcing continuous redraws.
      const spot = spotlightRef.current
      let overlay: SelectionOverlay | null = null
      if (spot) {
        const elapsed = now - spot.phaseStart
        const pt = spot.point
        let scrimAlpha: number
        let ringProgress: number
        if (spot.phase === 'in') {
          const p = Math.min(1, elapsed / SPOTLIGHT_IN_MS)
          const e = 1 - Math.pow(1 - p, 3) // easeOutCubic
          scrimAlpha = spot.scrimFrom + (SCRIM_MAX_ALPHA - spot.scrimFrom) * e
          ringProgress = spot.ringFrom + (1 - spot.ringFrom) * e
          if (p >= 1) spot.phase = 'hold'
          else dirtyRef.current = true
        } else if (spot.phase === 'hold') {
          scrimAlpha = SCRIM_MAX_ALPHA
          ringProgress = 1
        } else {
          const p = Math.min(1, elapsed / SPOTLIGHT_OUT_MS)
          scrimAlpha = spot.scrimFrom * (1 - p)
          ringProgress = spot.ringFrom * (1 - p)
          if (p >= 1) spotlightRef.current = null
          dirtyRef.current = true
        }
        spot.lastScrim = scrimAlpha
        spot.lastRing = ringProgress
        overlay = {
          ax: pt.ax, ay: pt.ay, bx: pt.bx, by: pt.by, r: pt.r,
          color: spot.color,
          scrimAlpha,
          ringProgress
        }
      }

      if (dirtyRef.current) {
        const dpr = window.devicePixelRatio || 1
        const r = renderedRef.current
        // Cap max tier on small viewports and low-core devices so mobile
        // never asks for the 1024x1024-per-tile tier 4 (4 MB raster each).
        // Tier 2 is plenty sharp at phone pixel densities.
        const isSmall = viewportSize.w < 768
        const lowCore = (navigator.hardwareConcurrency ?? 8) <= 4
        const maxTier: Tier = (isSmall || lowCore) ? 2 : 4
        const targetTier = pickTier(r.scale, dpr, currentTierRef.current, maxTier)
        currentTierRef.current = targetTier
        renderer.draw(r, viewportSize.w, viewportSize.h, dpr, targetTier, overlay)
        dirtyRef.current = false
        if (import.meta.env.DEV && authorMode) setRenderTick(n => n + 1)
      }

      // Recenter button visibility: only flip state when it changes.
      const zoomedIn = renderedRef.current.scale > minScale * 1.02
      if (zoomedIn !== isZoomedInRef.current) {
        isZoomedInRef.current = zoomedIn
        setIsZoomedIn(zoomedIn)
      }

      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => {
      stopped = true
      cancelAnimationFrame(rafRef.current)
    }
  }, [viewportSize.w, viewportSize.h, mapW, mapH, minScale, authorMode])

  const updateTransform = (next: Transform) => {
    targetRef.current = clampTransform(next, viewportSize.w, viewportSize.h, mapW, mapH, minScale)
    dirtyRef.current = true
  }

  const zoomAt = (clientX: number, clientY: number, factor: number) => {
    const t = transformRef.current
    const rect = viewportRef.current!.getBoundingClientRect()
    const px = clientX - rect.left
    const py = clientY - rect.top
    // Clamp scale first so the anchor math matches the actual rendered scale.
    const newScale = Math.max(minScale, Math.min(MAX_SCALE, t.scale * factor))
    // Keep (px, py) anchored: world point under cursor stays put.
    const worldX = (px - t.tx) / t.scale
    const worldY = (py - t.ty) / t.scale
    const tx = px - worldX * newScale
    const ty = py - worldY * newScale
    updateTransform({ tx, ty, scale: newScale })
  }

  // Launch an eased camera flight from the currently rendered transform.
  const flyTo = (to: Transform, duration: number) => {
    inertiaRef.current = null
    flyToRef.current = {
      from: { ...renderedRef.current },
      to,
      start: performance.now(),
      duration
    }
    dirtyRef.current = true
  }

  // Center a selected pill in the area left visible above the peeked sheet.
  const flyToPoint = (p: Point) => {
    const cx = (p.ax + p.bx) / 2
    const cy = (p.ay + p.by) / 2
    const s = targetRef.current.scale
    const peekPx = Math.round(window.innerHeight * PEEK_FRACTION)
    const to = clampTransform(
      {
        tx: viewportSize.w / 2 - cx * s,
        ty: (viewportSize.h - peekPx) / 2 - cy * s,
        scale: s
      },
      viewportSize.w, viewportSize.h, mapW, mapH, minScale
    )
    flyTo(to, 450)
  }

  // Begin (or move) the spotlight. On a selection switch the scrim is already
  // up — seed it from the last drawn value so it doesn't dip; the ring always
  // re-animates its settle-in on the new pill.
  const beginSpotlight = (point: Point, color: [number, number, number]) => {
    const prevScrim = spotlightRef.current?.lastScrim ?? 0
    spotlightRef.current = {
      point,
      color,
      phase: 'in',
      phaseStart: performance.now(),
      scrimFrom: prevScrim,
      ringFrom: 0,
      lastScrim: prevScrim,
      lastRing: 0
    }
    dirtyRef.current = true
  }

  const doubleTapZoom = (clientX: number, clientY: number) => {
    const t = targetRef.current
    let to: Transform
    if (t.scale >= MAX_SCALE * 0.98) {
      // At max zoom: toggle back to fit (clampTransform centers it).
      to = clampTransform({ tx: 0, ty: 0, scale: minScale }, viewportSize.w, viewportSize.h, mapW, mapH, minScale)
    } else {
      // Zoom a 2x step toward the tap point (world point under it stays put).
      const rect = viewportRef.current!.getBoundingClientRect()
      const px = clientX - rect.left
      const py = clientY - rect.top
      const nextScale = Math.min(MAX_SCALE, t.scale * 2)
      const worldX = (px - t.tx) / t.scale
      const worldY = (py - t.ty) / t.scale
      to = clampTransform(
        { tx: px - worldX * nextScale, ty: py - worldY * nextScale, scale: nextScale },
        viewportSize.w, viewportSize.h, mapW, mapH, minScale
      )
    }
    haptic()
    flyTo(to, 350)
  }

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture(e.pointerId)
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    tapTrackRef.current.set(e.pointerId, {
      startX: e.clientX,
      startY: e.clientY,
      maxDist: 0,
      pointerType: e.pointerType
    })
    velocitySamplesRef.current.set(e.pointerId, [{ t: e.timeStamp, x: e.clientX, y: e.clientY }])
    // A new touch cancels in-flight inertia and camera flights. Adopt the
    // *rendered* transform as the new target so the finger picks up exactly
    // where the eye sees the map — no teleport, no jarring stop.
    inertiaRef.current = null
    flyToRef.current = null
    targetRef.current = renderedRef.current
    gestureActiveRef.current = true
    if (pointersRef.current.size === 2) {
      const [a, b] = Array.from(pointersRef.current.values())
      const dist = Math.hypot(b.x - a.x, b.y - a.y)
      pinchStartRef.current = {
        dist,
        scale: transformRef.current.scale,
        centerX: (a.x + b.x) / 2,
        centerY: (a.y + b.y) / 2
      }
    }
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const prev = pointersRef.current.get(e.pointerId)
    if (!prev) return
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY })

    const tap = tapTrackRef.current.get(e.pointerId)
    if (tap) {
      const d = Math.hypot(e.clientX - tap.startX, e.clientY - tap.startY)
      if (d > tap.maxDist) tap.maxDist = d
      // First moment this gesture becomes a real drag/pinch: hide the chrome.
      if (d > TAP_MOVEMENT_THRESHOLD_CSS_PX) setChromeVisible(false)
    }

    const samples = velocitySamplesRef.current.get(e.pointerId)
    if (samples) {
      samples.push({ t: e.timeStamp, x: e.clientX, y: e.clientY })
      const cutoff = e.timeStamp - VELOCITY_SAMPLE_WINDOW_MS
      while (samples.length > 2 && samples[0].t < cutoff) samples.shift()
    }

    if (pointersRef.current.size === 1) {
      const t = transformRef.current
      const dx = e.clientX - prev.x
      const dy = e.clientY - prev.y
      updateTransform({ tx: t.tx + dx, ty: t.ty + dy, scale: t.scale })
    } else if (pointersRef.current.size === 2 && pinchStartRef.current) {
      const [a, b] = Array.from(pointersRef.current.values())
      const dist = Math.hypot(b.x - a.x, b.y - a.y)
      const factor = dist / pinchStartRef.current.dist
      const targetScale = pinchStartRef.current.scale * factor
      zoomAt(
        pinchStartRef.current.centerX,
        pinchStartRef.current.centerY,
        targetScale / transformRef.current.scale
      )
    }
  }

  const clientToWorld = (clientX: number, clientY: number) => {
    const rect = viewportRef.current!.getBoundingClientRect()
    const px = clientX - rect.left
    const py = clientY - rect.top
    const t = transformRef.current
    return { x: (px - t.tx) / t.scale, y: (py - t.ty) / t.scale }
  }

  // Returns true when the tap landed on empty space (used by the double-tap
  // disambiguation in endPointer).
  const tryHitTest = (clientX: number, clientY: number, pointerType: string, shift: boolean): boolean => {
    setAttributionOpen(false)
    const { x: worldX, y: worldY } = clientToWorld(clientX, clientY)
    const t = transformRef.current
    const slopCss = pointerType === 'touch' ? TOUCH_HIT_SLOP_CSS_PX : 0
    const slopWorld = slopCss / t.scale

    if (import.meta.env.DEV && authorMode) {
      handleAuthorTap({
        worldX,
        worldY,
        slopWorld,
        shift,
        pointsRef: workingPointsRef,
        editingId,
        setWorkingPoints,
        setEditingId,
        defaultR: 22
      })
      return false
    }

    const points = workingPointsRef.current
    const hit = points.length > 0 ? hitTest(worldX, worldY, points, slopWorld) : null
    if (hit && hit.point.id !== 'KCI-GMR') {
      if (hit.kind === 'hub') {
        // Hub region tapped (no member pill won). Resolve `HUB-…` id → slug.
        const slug = hubSlugById.get(hit.point.id)
        if (slug) {
          setSelectedStation(null)
          setSelectedHubSlug(slug)
          haptic()
          beginSpotlight(hit.point, hubColorById.get(hit.point.id) ?? SPOTLIGHT_NEUTRAL_COLOR)
          flyToPoint(hit.point)
        } else {
          console.warn('Unknown hub point id:', hit.point.id)
        }
      } else {
        // Pill IDs look like "KCI-MRI". Split on first hyphen so codes
        // containing further hyphens still parse correctly.
        const dash = hit.point.id.indexOf('-')
        if (dash > 0) {
          const operator = hit.point.id.slice(0, dash)
          const code = hit.point.id.slice(dash + 1)
          setSelectedHubSlug(null)
          setSelectedStation({ operator, code })
          haptic()
          // Halo starts neutral; re-tints when the station fetch resolves.
          beginSpotlight(hit.point, SPOTLIGHT_NEUTRAL_COLOR)
          flyToPoint(hit.point)
        } else {
          console.warn('Unrecognized point id format:', hit.point.id)
        }
      }
      return false
    }
    // Empty-space tap: toggle the chrome (show if hidden, hide if visible).
    setChromeVisible(v => !v)
    return true
  }

  const endPointer = (e: React.PointerEvent) => {
    const tap = tapTrackRef.current.get(e.pointerId)
    tapTrackRef.current.delete(e.pointerId)
    const samples = velocitySamplesRef.current.get(e.pointerId)
    velocitySamplesRef.current.delete(e.pointerId)
    const wasDrag = !!(tap && tap.maxDist > TAP_MOVEMENT_THRESHOLD_CSS_PX)
    const wasPinching = pinchStartRef.current !== null
    pointersRef.current.delete(e.pointerId)

    // Only run hit-test when this is a clean single-pointer tap (no pinch).
    if (
      e.type === 'pointerup'
      && tap
      && tap.maxDist <= TAP_MOVEMENT_THRESHOLD_CSS_PX
      && !wasPinching
    ) {
      // Tap ripple (screen-space DOM overlay; capped to 4 concurrent).
      const rect = viewportRef.current?.getBoundingClientRect()
      if (rect) {
        const id = rippleIdRef.current++
        const x = e.clientX - rect.left
        const y = e.clientY - rect.top
        setRipples(rs => [...rs.slice(-3), { id, x, y }])
      }

      // Double-tap detection without delaying single taps: the first tap
      // hit-tests immediately; a quick second tap near it becomes a zoom
      // (only for empty-space taps — a pill tap already has its selection
      // fly-to in motion).
      const prevTap = lastTapRef.current
      const isDoubleTap = !authorMode
        && prevTap !== null
        && e.timeStamp - prevTap.t < DOUBLE_TAP_MS
        && Math.hypot(e.clientX - prevTap.x, e.clientY - prevTap.y) < DOUBLE_TAP_RADIUS_CSS_PX
      if (isDoubleTap) {
        lastTapRef.current = null
        if (prevTap.wasEmpty) {
          // Revert the first tap's chrome toggle, then zoom.
          setChromeVisible(v => !v)
          doubleTapZoom(e.clientX, e.clientY)
        }
      } else {
        const wasEmpty = tryHitTest(e.clientX, e.clientY, tap.pointerType, e.shiftKey)
        lastTapRef.current = { t: e.timeStamp, x: e.clientX, y: e.clientY, wasEmpty }
      }
    }

    if (pointersRef.current.size < 2) {
      pinchStartRef.current = null
    }

    // When the last pointer lifts after a drag (no pinch), launch inertia
    // from the recent velocity samples.
    if (pointersRef.current.size === 0) {
      gestureActiveRef.current = false
      if (wasDrag && !wasPinching && samples && samples.length >= 2 && e.type === 'pointerup') {
        const last = samples[samples.length - 1]
        const first = samples[0]
        const dt = last.t - first.t
        if (dt > 0) {
          inertiaRef.current = {
            vx: (last.x - first.x) / dt,
            vy: (last.y - first.y) / dt
          }
          dirtyRef.current = true
        }
      }
    }
  }

  // Browsers fire `wheel` as a passive listener on React's synthetic handler, so
  // calling preventDefault() in the React handler logs a warning. Attach a native
  // non-passive listener instead.
  useEffect(() => {
    const el = viewportRef.current
    if (!el) return
    const handler = (ev: WheelEvent) => {
      ev.preventDefault()
      // Manual zoom takes over from any in-flight camera animation.
      flyToRef.current = null
      const factor = Math.exp(-ev.deltaY * WHEEL_ZOOM_INTENSITY)
      zoomAt(ev.clientX, ev.clientY, factor)
      setChromeVisible(false)
    }
    el.addEventListener('wheel', handler, { passive: false })
    return () => el.removeEventListener('wheel', handler)
  }, [manifest, minScale, viewportSize.w, viewportSize.h, mapW, mapH])

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
      <div
        ref={viewportRef}
        className="absolute inset-0 touch-none select-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
        onPointerLeave={endPointer}
        role="img"
        aria-label="Peta integrasi transportasi umum Jakarta"
      >
        <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />
        {ripples.map(r => (
          <span
            key={r.id}
            className="map-ripple"
            style={{ left: r.x, top: r.y }}
            onAnimationEnd={() => setRipples(rs => rs.filter(x => x.id !== r.id))}
            aria-hidden
          />
        ))}
      </div>

      <div
        className={`absolute inset-x-0 top-0 z-10 bg-white/50 backdrop-blur border-b-2 border-b-gray-50/20 transition-opacity duration-200 ${chromeVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
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
        onClick={() => {
          haptic()
          flyTo(
            clampTransform({ tx: 0, ty: 0, scale: minScale }, viewportSize.w, viewportSize.h, mapW, mapH, minScale),
            450
          )
        }}
        aria-label="Kembali ke tampilan penuh"
        tabIndex={isZoomedIn ? 0 : -1}
        className={`absolute bottom-4 right-16 z-20 rounded-full bg-white/90 backdrop-blur shadow-lg w-10 h-10 flex items-center justify-center cursor-pointer transition-opacity duration-200 ${isZoomedIn ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
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
          rendered={renderedRef.current}
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
        onDismissStart={() => { if (!selectedHubSlug) beginSpotlightExit() }}
      />

      <HubSheet
        slug={selectedHubSlug}
        onClose={() => setSelectedHubSlug(null)}
        onDismissStart={() => { if (!selectedStation) beginSpotlightExit() }}
      />
    </main>
  )
}
