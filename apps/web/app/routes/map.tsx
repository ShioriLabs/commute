import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { ArrowLeftIcon } from '@phosphor-icons/react'
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
  const debugHitboxes = searchParams.get('debug') === 'hitboxes'
  const authorMode = searchParams.get('author') === '1' && import.meta.env.DEV

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

  // On first measurement, center the map at fit-scale.
  const didCenterRef = useRef(false)
  useEffect(() => {
    if (didCenterRef.current) return
    if (!viewportSize.w || !viewportSize.h || !mapW || !mapH) return
    const fitScale = Math.max(viewportSize.w / mapW, viewportSize.h / mapH)
    const tx = (viewportSize.w - mapW * fitScale) / 2
    const ty = (viewportSize.h - mapH * fitScale) / 2
    const initial = { tx, ty, scale: fitScale }
    targetRef.current = initial
    renderedRef.current = initial
    dirtyRef.current = true
    didCenterRef.current = true
  }, [viewportSize.w, viewportSize.h, mapW, mapH])

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
        const targetTier = pickTier(r.scale, dpr, currentTierRef.current)
        currentTierRef.current = targetTier
        renderer.draw(r, viewportSize.w, viewportSize.h, dpr, targetTier)
        dirtyRef.current = false
        if (authorMode) setRenderTick(n => n + 1)
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
    const { x: worldX, y: worldY } = clientToWorld(clientX, clientY)
    const t = transformRef.current
    const slopCss = pointerType === 'touch' ? TOUCH_HIT_SLOP_CSS_PX : 0
    const slopWorld = slopCss / t.scale

    if (authorMode) {
      const points = workingPointsRef.current
      const hit = hitTestPoints(worldX, worldY, points, slopWorld)
      if (hit && shift) {
        // Shift+tap on an existing pill: extend it to a capsule whose second
        // endpoint is the *next* non-shift tap. We mark it as "extending" by
        // setting editingId; the next plain tap completes the extension.
        setEditingId(hit.id)
        return
      }
      if (hit) {
        // Plain tap on existing pill: enter edit mode for its id.
        setEditingId(hit.id)
        return
      }
      // Empty space: drop a new circle pill (or finish an extension if one is in flight).
      if (editingId !== null) {
        const idx = workingPointsRef.current.findIndex(p => p.id === editingId)
        if (idx >= 0) {
          const target = workingPointsRef.current[idx]
          // Only "extend" if the existing pill is still a degenerate circle
          // and the user shift-tapped it earlier.
          const isCircle = target.ax === target.bx && target.ay === target.by
          if (isCircle) {
            const next = [...workingPointsRef.current]
            next[idx] = { ...target, bx: worldX, by: worldY }
            setWorkingPoints(next)
            return
          }
        }
      }
      const defaultR = 22
      const newId = `new-${Date.now().toString(36)}`
      setWorkingPoints([
        ...workingPointsRef.current,
        { id: newId, ax: worldX, ay: worldY, bx: worldX, by: worldY, r: defaultR }
      ])
      setEditingId(newId)
      return
    }

    const points = workingPointsRef.current
    if (!points || points.length === 0) return
    const hit = hitTestPoints(worldX, worldY, points, slopWorld)
    if (hit) console.log('[map] hit', hit.id)
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

      <Link
        to="/"
        className="absolute top-4 left-4 z-10 bg-white rounded-full shadow-lg p-3 flex items-center justify-center"
        aria-label="Kembali ke beranda"
      >
        <ArrowLeftIcon weight="bold" className="w-6 h-6 text-slate-700" />
      </Link>

      <div className="absolute bottom-4 right-4 z-10 bg-white/90 backdrop-blur px-3 py-1 rounded-md text-xs text-slate-600 shadow">
        © FDTJ •
        {' '}
        {manifest.version}
      </div>

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
    </main>
  )
}

interface AuthorOverlayProps {
  viewportRef: React.RefObject<HTMLDivElement | null>
  points: Point[]
  editingId: string | null
  rendered: Transform
  onChange: (next: Point[]) => void
  onSetEditingId: (id: string | null) => void
  onExport: () => void
  onClear: () => void
}

function AuthorOverlay({
  viewportRef,
  points,
  editingId,
  rendered,
  onChange,
  onSetEditingId,
  onExport,
  onClear
}: AuthorOverlayProps) {
  const editing = editingId !== null ? points.find(p => p.id === editingId) : null

  // Draft state — the ID input is buffered so partial typing (e.g. "SUDB" mid-
  // way to "SUDBA") doesn't clobber an existing pill with the same prefix.
  // Committed on Done / Enter; reverted on Esc / panel close.
  const [draftId, setDraftId] = useState('')
  useEffect(() => {
    setDraftId(editing?.id ?? '')
  }, [editing?.id])

  // Project a world point to screen-space CSS pixels using the rendered
  // transform — same math the renderer uses, kept in JS for the floating UI.
  const project = (worldX: number, worldY: number) => ({
    x: worldX * rendered.scale + rendered.tx,
    y: worldY * rendered.scale + rendered.ty
  })

  // Update a non-ID field immediately (no collision risk).
  const updateEditingField = (patch: Partial<Omit<Point, 'id'>>) => {
    if (!editing) return
    onChange(points.map(p => (p.id === editing.id ? { ...p, ...patch } : p)))
  }

  const commitId = () => {
    if (!editing) return
    const next = draftId.trim()
    if (!next || next === editing.id) {
      onSetEditingId(null)
      return
    }
    // Reject duplicates rather than silently merging two pills.
    if (points.some(p => p.id === next)) {
      window.alert(`ID "${next}" already exists. Choose a different ID.`)
      return
    }
    onChange(points.map(p => (p.id === editing.id ? { ...p, id: next } : p)))
    onSetEditingId(null)
  }

  const cancelEdit = () => {
    setDraftId(editing?.id ?? '')
    onSetEditingId(null)
  }

  const deleteEditing = () => {
    if (!editing) return
    onChange(points.filter(p => p.id !== editing.id))
    onSetEditingId(null)
  }

  // Nudge both endpoints by the same (dx, dy) so circles stay circles and
  // capsules keep their length/orientation. `step` is in world units.
  const nudgeEditing = (dx: number, dy: number) => {
    if (!editing) return
    onChange(points.map(p => p.id === editing.id
      ? { ...p, ax: p.ax + dx, ay: p.ay + dy, bx: p.bx + dx, by: p.by + dy }
      : p
    ))
  }

  // Arrow keys nudge the editing pill while any control inside the panel has
  // focus. Shift = 5× step. Step size is 1 world unit (≈ subpixel at fit-scale,
  // ~10px at max zoom), matching the "minor nudge" use case.
  useEffect(() => {
    if (!editing) return
    const onKeyDown = (e: KeyboardEvent) => {
      // Skip if focus is in the ID text input — arrow keys move the caret there.
      const target = e.target as HTMLElement | null
      const isTextInput = target?.tagName === 'INPUT' && (target as HTMLInputElement).type === 'text'
      if (isTextInput) return
      const step = e.shiftKey ? 5 : 1
      let dx = 0
      let dy = 0
      if (e.key === 'ArrowLeft') dx = -step
      else if (e.key === 'ArrowRight') dx = step
      else if (e.key === 'ArrowUp') dy = -step
      else if (e.key === 'ArrowDown') dy = step
      else return
      e.preventDefault()
      nudgeEditing(dx, dy)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [editing, points])

  const editingScreen = editing
    ? project((editing.ax + editing.bx) / 2, (editing.ay + editing.by) / 2)
    : null

  // Measure the panel so we can flip it above/left of the pill when there's
  // no room below/right. Falls back to conservative defaults pre-measurement.
  const panelRef = useRef<HTMLDivElement | null>(null)
  const [panelSize, setPanelSize] = useState({ w: 240, h: 280 })
  useLayoutEffect(() => {
    if (!panelRef.current) return
    const rect = panelRef.current.getBoundingClientRect()
    if (rect.width && rect.height && (Math.abs(rect.width - panelSize.w) > 1 || Math.abs(rect.height - panelSize.h) > 1)) {
      setPanelSize({ w: rect.width, h: rect.height })
    }
  })

  const panelPosition = (() => {
    if (!editing || !editingScreen || !viewportRef.current) return null
    const vw = viewportRef.current.clientWidth
    const vh = viewportRef.current.clientHeight
    const margin = 12
    const gap = 16
    // Approximate the pill's screen-space radius for the offset so the panel
    // doesn't overlap the pill when there's plenty of room.
    const offsetX = editing.r * rendered.scale + gap
    const offsetY = editing.r * rendered.scale + gap
    // Prefer right; flip left if right doesn't fit.
    const fitsRight = editingScreen.x + offsetX + panelSize.w + margin <= vw
    const left = fitsRight
      ? editingScreen.x + offsetX
      : editingScreen.x - offsetX - panelSize.w
    // Prefer below; flip above if below doesn't fit.
    const fitsBelow = editingScreen.y + offsetY + panelSize.h + margin <= vh
    const top = fitsBelow
      ? editingScreen.y + offsetY
      : editingScreen.y - offsetY - panelSize.h
    return {
      left: clampUI(left, margin, Math.max(margin, vw - panelSize.w - margin)),
      top: clampUI(top, margin, Math.max(margin, vh - panelSize.h - margin))
    }
  })()

  return (
    <>
      <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 bg-white/95 backdrop-blur rounded-lg shadow-lg px-3 py-2 flex gap-2 items-center text-sm">
        <span className="font-mono text-slate-700">
          {points.length}
          {' pills'}
        </span>
        <button
          type="button"
          onClick={onExport}
          className="px-3 py-1 rounded bg-rose-100 hover:bg-rose-200 text-pink-800 font-semibold"
        >
          Export
        </button>
        <button
          type="button"
          onClick={onClear}
          className="px-3 py-1 rounded bg-slate-100 hover:bg-slate-200 text-slate-700"
        >
          Clear
        </button>
        <span className="text-xs text-slate-500 ml-2">
          tap empty space = new pill · tap pill = edit · shift-tap then tap empty space = extend to capsule
        </span>
      </div>

      {editing && panelPosition && (
        <div
          ref={panelRef}
          className="absolute z-20 bg-white rounded-lg shadow-xl border border-slate-200 p-3 flex flex-col gap-2 min-w-[220px]"
          style={{ left: panelPosition.left, top: panelPosition.top }}
          onPointerDown={e => e.stopPropagation()}
        >
          <label className="flex flex-col gap-1">
            <span className="text-xs font-semibold text-slate-600">ID (e.g. KCI-MRI)</span>
            <input
              type="text"
              value={draftId}
              onChange={e => setDraftId(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  commitId()
                } else if (e.key === 'Escape') {
                  e.preventDefault()
                  cancelEdit()
                }
              }}
              className="px-2 py-1 border border-slate-300 rounded font-mono text-sm"
              autoFocus
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-semibold text-slate-600">Radius (world units)</span>
            <input
              type="number"
              value={editing.r}
              step="1"
              min="1"
              onChange={e => updateEditingField({ r: Number(e.target.value) })}
              className="px-2 py-1 border border-slate-300 rounded font-mono text-sm"
            />
          </label>
          <div className="flex flex-col gap-1">
            <span className="text-xs font-semibold text-slate-600">Nudge (1u · shift = 5u)</span>
            <div className="grid grid-cols-3 gap-1 w-fit">
              <span />
              <button type="button" onClick={e => nudgeEditing(0, e.shiftKey ? -5 : -1)} className="px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm" aria-label="Nudge up">↑</button>
              <span />
              <button type="button" onClick={e => nudgeEditing(e.shiftKey ? -5 : -1, 0)} className="px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm" aria-label="Nudge left">←</button>
              <span />
              <button type="button" onClick={e => nudgeEditing(e.shiftKey ? 5 : 1, 0)} className="px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm" aria-label="Nudge right">→</button>
              <span />
              <button type="button" onClick={e => nudgeEditing(0, e.shiftKey ? 5 : 1)} className="px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm" aria-label="Nudge down">↓</button>
              <span />
            </div>
          </div>
          <div className="text-xs font-mono text-slate-500">
            A (
            {editing.ax.toFixed(1)}
            ,
            {' '}
            {editing.ay.toFixed(1)}
            )
            {!(editing.ax === editing.bx && editing.ay === editing.by) && (
              <>
                {' → B ('}
                {editing.bx.toFixed(1)}
                ,
                {' '}
                {editing.by.toFixed(1)}
                )
              </>
            )}
          </div>
          <div className="flex gap-2 justify-end pt-1">
            <button
              type="button"
              onClick={deleteEditing}
              className="px-2 py-1 rounded text-rose-700 hover:bg-rose-50 text-sm"
            >
              Delete
            </button>
            <button
              type="button"
              onClick={commitId}
              className="px-3 py-1 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </>
  )
}

function clampUI(v: number, lo: number, hi: number): number {
  if (hi < lo) return lo
  return Math.min(hi, Math.max(lo, v))
}
