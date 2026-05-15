import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { ArrowLeftIcon } from '@phosphor-icons/react'
import useSWR from 'swr'
import {
  createRenderer,
  hitTestPoints,
  pickTier,
  type Manifest,
  type PointsManifest,
  type Renderer,
  type Tier,
  type Transform
} from '../lib/map-renderer'

const TAP_MOVEMENT_THRESHOLD_CSS_PX = 8
const TOUCH_HIT_SLOP_CSS_PX = 12

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

  const viewportRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rendererRef = useRef<Renderer | null>(null)
  const dirtyRef = useRef(true)
  const rafRef = useRef<number>(0)
  const currentTierRef = useRef<Tier>(1)

  const [viewportSize, setViewportSize] = useState({ w: 0, h: 0 })
  const [transform, setTransform] = useState<Transform>({ tx: 0, ty: 0, scale: 1 })
  const transformRef = useRef(transform)
  transformRef.current = transform

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
  const minScale = (viewportSize.w && viewportSize.h && mapW && mapH)
    ? Math.min(viewportSize.w / mapW, viewportSize.h / mapH)
    : 0.01

  // On first measurement, center the map at fit-scale.
  const didCenterRef = useRef(false)
  useEffect(() => {
    if (didCenterRef.current) return
    if (!viewportSize.w || !viewportSize.h || !mapW || !mapH) return
    const fitScale = Math.min(viewportSize.w / mapW, viewportSize.h / mapH)
    const tx = (viewportSize.w - mapW * fitScale) / 2
    const ty = (viewportSize.h - mapH * fitScale) / 2
    setTransform({ tx, ty, scale: fitScale })
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
    rendererRef.current.setPoints(pointsManifest?.points ?? [])
    rendererRef.current.setDebugHitboxes(debugHitboxes)
  }, [pointsManifest, debugHitboxes, manifest])

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

  // Mark dirty whenever the transform changes.
  useEffect(() => {
    dirtyRef.current = true
  }, [transform])

  // requestAnimationFrame loop: only redraws when dirty.
  useEffect(() => {
    let stopped = false
    const tick = () => {
      if (stopped) return
      const renderer = rendererRef.current
      if (renderer && dirtyRef.current && viewportSize.w && viewportSize.h) {
        const dpr = window.devicePixelRatio || 1
        const t = transformRef.current
        const targetTier = pickTier(t.scale, dpr, currentTierRef.current)
        currentTierRef.current = targetTier
        renderer.draw(t, viewportSize.w, viewportSize.h, dpr, targetTier)
        dirtyRef.current = false
      }
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => {
      stopped = true
      cancelAnimationFrame(rafRef.current)
    }
  }, [viewportSize.w, viewportSize.h])

  const updateTransform = (next: Transform) => {
    setTransform(clampTransform(next, viewportSize.w, viewportSize.h, mapW, mapH, minScale))
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

  const tryHitTest = (clientX: number, clientY: number, pointerType: string) => {
    const points = pointsManifest?.points
    if (!points || points.length === 0) return
    const rect = viewportRef.current!.getBoundingClientRect()
    const px = clientX - rect.left
    const py = clientY - rect.top
    const t = transformRef.current
    const worldX = (px - t.tx) / t.scale
    const worldY = (py - t.ty) / t.scale
    const slopCss = pointerType === 'touch' ? TOUCH_HIT_SLOP_CSS_PX : 0
    const slopWorld = slopCss / t.scale
    const hit = hitTestPoints(worldX, worldY, points, slopWorld)
    if (hit) console.log('[map] hit', hit.id)
  }

  const endPointer = (e: React.PointerEvent) => {
    const tap = tapTrackRef.current.get(e.pointerId)
    tapTrackRef.current.delete(e.pointerId)
    pointersRef.current.delete(e.pointerId)
    // Only run hit-test when this is a clean single-pointer tap (no pinch).
    if (
      e.type === 'pointerup'
      && tap
      && tap.maxDist <= TAP_MOVEMENT_THRESHOLD_CSS_PX
      && pinchStartRef.current === null
    ) {
      tryHitTest(e.clientX, e.clientY, tap.pointerType)
    }
    if (pointersRef.current.size < 2) {
      pinchStartRef.current = null
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
    </main>
  )
}
