import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link, useNavigate, useNavigationType, useSearchParams } from 'react-router'
import { XIcon, InfoIcon } from '@phosphor-icons/react'
import useSWR from 'swr'
import {
  createRenderer,
  hitTestPoints,
  pickTier,
  type Manifest,
  type Point,
  type PointsManifest,
  type Renderer,
  type Tier,
  type Transform
} from '../lib/map-renderer'
import { AuthorOverlay, handleAuthorTap } from '../components/map-author'
import StationSheet from '../components/station-sheet'

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

export function meta() {
  return [
    { title: 'Peta Integrasi - Commute' },
    { name: 'theme-color', content: '#FFFFFF' }
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
  // Falls back to fit-to-viewport center if the anchor pill isn't loaded yet
  // (in which case the next time this effect runs it will re-center properly).
  const didCenterRef = useRef(false)
  useEffect(() => {
    if (didCenterRef.current) return
    if (!viewportSize.w || !viewportSize.h || !mapW || !mapH) return

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
    didCenterRef.current = true
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
        renderer.draw(r, viewportSize.w, viewportSize.h, dpr, targetTier)
        dirtyRef.current = false
        if (import.meta.env.DEV && authorMode) setRenderTick(n => n + 1)
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
    // A new touch cancels in-flight inertia. Adopt the *rendered* transform
    // as the new target so the finger picks up exactly where the eye sees
    // the map — no teleport, no jarring stop.
    inertiaRef.current = null
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

  const tryHitTest = (clientX: number, clientY: number, pointerType: string, shift: boolean) => {
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
      return
    }

    const points = workingPointsRef.current
    const hit = points.length > 0 ? hitTestPoints(worldX, worldY, points, slopWorld) : null
    if (hit && hit.id !== 'KCI-GMR') {
      // Pill IDs look like "KCI-MRI". Split on first hyphen so codes
      // containing further hyphens still parse correctly.
      const dash = hit.id.indexOf('-')
      if (dash > 0) {
        const operator = hit.id.slice(0, dash)
        const code = hit.id.slice(dash + 1)
        setSelectedStation({ operator, code })
      } else {
        console.warn('Unrecognized point id format:', hit.id)
      }
    } else {
      // Empty-space tap: toggle the chrome (show if hidden, hide if visible).
      setChromeVisible(v => !v)
    }
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
      tryHitTest(e.clientX, e.clientY, tap.pointerType, e.shiftKey)
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
      />
    </main>
  )
}
