import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { ArrowLeftIcon } from '@phosphor-icons/react'
import useSWR from 'swr'

interface Manifest {
  version: string
  source: string
  viewBox: [number, number, number, number]
  grid: { rows: number, cols: number }
  tileSize: { w: number, h: number }
}

export function meta() {
  return [
    { title: 'Peta Integrasi - Commute' },
    { name: 'theme-color', content: '#FFFFFF' }
  ]
}

const MIN_SCALE_BLEED = 0.1
const MAX_SCALE = 6
const WHEEL_ZOOM_INTENSITY = 0.0015

type Transform = { tx: number, ty: number, scale: number }

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
  // Allow panning up to the edge of the map; never allow the entire map to leave the viewport.
  const minTx = Math.min(0, viewportW - scaledW)
  const maxTx = Math.max(0, viewportW - scaledW)
  const minTy = Math.min(0, viewportH - scaledH)
  const maxTy = Math.max(0, viewportH - scaledH)
  return {
    tx: Math.min(maxTx, Math.max(minTx, t.tx)),
    ty: Math.min(maxTy, Math.max(minTy, t.ty)),
    scale
  }
}

export default function MapPage() {
  const { data: manifest, error } = useSWR<Manifest>(
    '/maps/fdtj/manifest.json',
    (url: string) => fetch(url).then(r => r.json())
  )

  const viewportRef = useRef<HTMLDivElement>(null)
  const [viewportSize, setViewportSize] = useState({ w: 0, h: 0 })
  const [transform, setTransform] = useState<Transform>({ tx: 0, ty: 0, scale: 1 })
  const transformRef = useRef(transform)
  transformRef.current = transform

  // Track pointer state without re-rendering.
  const pointersRef = useRef<Map<number, { x: number, y: number }>>(new Map())
  const pinchStartRef = useRef<{ dist: number, scale: number, centerX: number, centerY: number } | null>(null)

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
  }, [])

  // Compute the minimum scale that fits the whole map into the viewport (with a small bleed).
  const mapW = manifest?.viewBox[2] ?? 0
  const mapH = manifest?.viewBox[3] ?? 0
  const minScale = (viewportSize.w && viewportSize.h && mapW && mapH)
    ? Math.min(viewportSize.w / mapW, viewportSize.h / mapH) - MIN_SCALE_BLEED
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

  const updateTransform = (next: Transform) => {
    setTransform(clampTransform(next, viewportSize.w, viewportSize.h, mapW, mapH, minScale))
  }

  const zoomAt = (clientX: number, clientY: number, factor: number) => {
    const t = transformRef.current
    const rect = viewportRef.current!.getBoundingClientRect()
    const px = clientX - rect.left
    const py = clientY - rect.top
    const newScale = t.scale * factor
    // Keep (px, py) anchored: world point under cursor stays put.
    const worldX = (px - t.tx) / t.scale
    const worldY = (py - t.ty) / t.scale
    const tx = px - worldX * newScale
    const ty = py - worldY * newScale
    updateTransform({ tx, ty, scale: newScale })
  }

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault()
    const factor = Math.exp(-e.deltaY * WHEEL_ZOOM_INTENSITY)
    zoomAt(e.clientX, e.clientY, factor)
  }

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture(e.pointerId)
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
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

  const endPointer = (e: React.PointerEvent) => {
    pointersRef.current.delete(e.pointerId)
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
  }, [])

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

  const { grid, tileSize } = manifest

  return (
    <main className="fixed inset-0 bg-rose-50/40 overflow-hidden">
      <div
        ref={viewportRef}
        className="absolute inset-0 touch-none select-none"
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
        onPointerLeave={endPointer}
        role="img"
        aria-label="Peta integrasi transportasi umum Jakarta"
      >
        <div
          className="absolute top-0 left-0 origin-top-left"
          style={{
            width: mapW,
            height: mapH,
            transform: `translate(${transform.tx}px, ${transform.ty}px) scale(${transform.scale})`,
            transformOrigin: '0 0',
            willChange: 'transform'
          }}
        >
          {Array.from({ length: grid.rows }).flatMap((_, r) =>
            Array.from({ length: grid.cols }).map((_, c) => (
              <img
                key={`${r}-${c}`}
                src={`/maps/fdtj/tile-${r}-${c}.svg`}
                alt=""
                draggable={false}
                loading="lazy"
                className="absolute pointer-events-none"
                style={{
                  left: c * tileSize.w,
                  top: r * tileSize.h,
                  width: tileSize.w,
                  height: tileSize.h
                }}
              />
            ))
          )}
        </div>
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
