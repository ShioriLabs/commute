import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { ArrowLeftIcon } from '@phosphor-icons/react'
import useSWR from 'swr'

type Layer = 'terrain' | 'landmarks' | 'lines' | 'labels' | 'stations'
const REBAKE_ON_ZOOM: Record<Layer, boolean> = {
  terrain: false,
  landmarks: true,
  lines: true,
  labels: true,
  stations: true
}

const LAYER_DEBUG_LABELS: Record<Layer, string> = {
  terrain: 'Terrain',
  landmarks: 'Landmarks',
  lines: 'Lines',
  labels: 'Labels',
  stations: 'Stations'
}

interface Manifest {
  version: string
  source: string
  viewBox: [number, number, number, number]
  mapBBox: [number, number, number, number]
  chromeBBox: [number, number, number, number]
  grid: { rows: number, cols: number }
  tileSize: { w: number, h: number }
  layers: Layer[]
  palette: string[]
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
const REBAKE_IDLE_MS = 200
const REBAKE_THRESHOLD = 1.4
const MAX_BAKE_TILE_PX = 4096

type Transform = { tx: number, ty: number, scale: number }
type Size = { w: number, h: number }

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

async function loadSvgImage(url: string): Promise<HTMLImageElement> {
  const res = await fetch(url)
  const text = await res.text()
  const blob = new Blob([text], { type: 'image/svg+xml' })
  const blobUrl = URL.createObjectURL(blob)
  try {
    const img = new Image()
    img.decoding = 'async'
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error(`Failed to load ${url}`))
      img.src = blobUrl
    })
    return img
  } finally {
    URL.revokeObjectURL(blobUrl)
  }
}

function bakeTile(img: HTMLImageElement, tilePxW: number, tilePxH: number): HTMLCanvasElement {
  const w = Math.min(MAX_BAKE_TILE_PX, Math.ceil(tilePxW))
  const h = Math.min(MAX_BAKE_TILE_PX, Math.ceil(tilePxH))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(img, 0, 0, w, h)
  return canvas
}

export default function MapPage() {
  const { data: manifest, error } = useSWR<Manifest>(
    '/maps/fdtj/manifest.json',
    (url: string) => fetch(url).then(r => r.json())
  )

  const viewportRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)

  // All state that event handlers read goes into refs so handlers see live values
  // (the wheel listener registers once, so any state in its closure would go stale).
  const manifestRef = useRef<Manifest | null>(null)
  manifestRef.current = manifest ?? null
  const viewportSizeRef = useRef<Size>({ w: 0, h: 0 })
  const transformRef = useRef<Transform>({ tx: 0, ty: 0, scale: 1 })
  const minScaleRef = useRef(0.01)

  // overlayTick only forces a render so React updates child <button>s on the overlay
  // (none yet, but the hook is ready for the future station-overlay pass).
  const [, setOverlayTick] = useState(0)

  // Debug panel: which layers are currently rendered.
  const [layerVisibility, setLayerVisibility] = useState<Record<Layer, boolean>>({
    terrain: true,
    landmarks: true,
    lines: true,
    labels: true,
    stations: true
  })
  const layerVisibilityRef = useRef(layerVisibility)
  layerVisibilityRef.current = layerVisibility
  const [debugPanelOpen, setDebugPanelOpen] = useState(false)

  // Per-layer tile state.
  const tileImagesRef = useRef<Map<string, HTMLImageElement>>(new Map())
  const tileBitmapsRef = useRef<Map<string, HTMLCanvasElement>>(new Map())
  const bakeScaleRef = useRef<Map<Layer, number>>(new Map())
  const rebakeTimerRef = useRef<number | null>(null)

  // Pointer state without re-rendering.
  const pointersRef = useRef<Map<number, { x: number, y: number }>>(new Map())
  const pinchStartRef = useRef<{ dist: number, scale: number, centerX: number, centerY: number } | null>(null)

  // -------- Imperative draw loop ---------------------------------------------
  const drawPendingRef = useRef(false)
  const scheduleDraw = () => {
    if (drawPendingRef.current) return
    drawPendingRef.current = true
    requestAnimationFrame(() => {
      drawPendingRef.current = false
      draw()
    })
  }

  const draw = () => {
    const canvas = canvasRef.current
    const overlay = overlayRef.current
    const m = manifestRef.current
    if (!canvas || !m) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const t = transformRef.current
    const dpr = window.devicePixelRatio || 1
    const { grid, tileSize, layers } = m

    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.setTransform(dpr * t.scale, 0, 0, dpr * t.scale, dpr * t.tx, dpr * t.ty)

    const visibility = layerVisibilityRef.current
    for (const layer of layers) {
      if (!visibility[layer]) continue
      for (let r = 0; r < grid.rows; r++) {
        for (let c = 0; c < grid.cols; c++) {
          const key = `${layer}-${r}-${c}`
          const bitmap = tileBitmapsRef.current.get(key)
          if (!bitmap) continue
          ctx.drawImage(bitmap, c * tileSize.w, r * tileSize.h, tileSize.w, tileSize.h)
        }
      }
    }

    if (overlay) {
      overlay.style.transform = `translate(${t.tx}px, ${t.ty}px) scale(${t.scale})`
    }
  }

  // -------- Sizing -----------------------------------------------------------
  // Sync the canvas backing store + the cached viewport size whenever the
  // viewport <div> resizes. We measure synchronously on mount so the canvas
  // shows the correct size on the first paint.
  const syncViewportSize = () => {
    const el = viewportRef.current
    const canvas = canvasRef.current
    if (!el || !canvas) return
    const rect = el.getBoundingClientRect()
    const w = rect.width
    const h = rect.height
    if (w <= 0 || h <= 0) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.round(w * dpr)
    canvas.height = Math.round(h * dpr)
    canvas.style.width = `${w}px`
    canvas.style.height = `${h}px`
    viewportSizeRef.current = { w, h }
    recomputeMinScale()
    scheduleDraw()
  }

  useLayoutEffect(() => {
    // Viewport <div> only exists after the manifest load gate flips, so we run
    // this when `manifest` becomes available (not just on first mount).
    syncViewportSize()
    const el = viewportRef.current
    if (!el) return
    const ro = new ResizeObserver(() => syncViewportSize())
    ro.observe(el)
    return () => ro.disconnect()
  }, [manifest])

  // -------- Centering on first paint -----------------------------------------
  const didCenterRef = useRef(false)
  const recomputeMinScale = () => {
    const m = manifestRef.current
    const vp = viewportSizeRef.current
    if (!m || !vp.w || !vp.h) {
      minScaleRef.current = 0.01
      return
    }
    const mapW = m.viewBox[2]
    const mapH = m.viewBox[3]
    minScaleRef.current = Math.min(vp.w / mapW, vp.h / mapH) - MIN_SCALE_BLEED
  }

  const centerIfNeeded = () => {
    if (didCenterRef.current) return
    const m = manifestRef.current
    const vp = viewportSizeRef.current
    if (!m || !vp.w || !vp.h) return
    const mapW = m.viewBox[2]
    const mapH = m.viewBox[3]
    const fitScale = Math.min(vp.w / mapW, vp.h / mapH)
    transformRef.current = {
      tx: (vp.w - mapW * fitScale) / 2,
      ty: (vp.h - mapH * fitScale) / 2,
      scale: fitScale
    }
    didCenterRef.current = true
    scheduleDraw()
  }

  useEffect(() => {
    recomputeMinScale()
    centerIfNeeded()
    // viewport may have settled before manifest arrived (or vice versa); whichever
    // comes last triggers the actual centering.
  }, [manifest])

  // Re-draw whenever debug visibility toggles change.
  useEffect(() => {
    scheduleDraw()
  }, [layerVisibility])

  // -------- Tile loading + baking --------------------------------------------
  useEffect(() => {
    if (!manifest) return
    let cancelled = false
    const load = async () => {
      const { grid, layers } = manifest
      await Promise.all(
        layers.flatMap(layer =>
          Array.from({ length: grid.rows }).flatMap((_, r) =>
            Array.from({ length: grid.cols }).map(async (_, c) => {
              const key = `${layer}-${r}-${c}`
              if (tileImagesRef.current.has(key)) return
              try {
                const img = await loadSvgImage(`/maps/fdtj/tile-${layer}-${r}-${c}.svg`)
                if (cancelled) return
                tileImagesRef.current.set(key, img)
              } catch {
                // Per-tile failure ignored; layer still renders the rest.
              }
            })
          )
        )
      )
      if (cancelled) return
      bakeAllLayers(transformRef.current.scale)
      scheduleDraw()
    }
    load()
    return () => {
      cancelled = true
    }
  }, [manifest])

  const bakeLayer = (layer: Layer, atScale: number) => {
    const m = manifestRef.current
    if (!m) return
    const { grid, tileSize } = m
    const dpr = window.devicePixelRatio || 1
    const tilePxW = tileSize.w * atScale * dpr
    const tilePxH = tileSize.h * atScale * dpr
    for (let r = 0; r < grid.rows; r++) {
      for (let c = 0; c < grid.cols; c++) {
        const key = `${layer}-${r}-${c}`
        const img = tileImagesRef.current.get(key)
        if (!img) continue
        tileBitmapsRef.current.set(key, bakeTile(img, tilePxW, tilePxH))
      }
    }
    bakeScaleRef.current.set(layer, atScale)
  }

  const bakeAllLayers = (atScale: number) => {
    const m = manifestRef.current
    if (!m) return
    for (const layer of m.layers) {
      bakeLayer(layer, atScale)
    }
  }

  const maybeRebake = () => {
    const m = manifestRef.current
    if (!m) return
    const current = transformRef.current.scale
    let didRebake = false
    for (const layer of m.layers) {
      if (!REBAKE_ON_ZOOM[layer]) continue
      const baked = bakeScaleRef.current.get(layer) ?? 0
      if (!baked) continue
      const ratio = current / baked
      if (ratio > REBAKE_THRESHOLD || ratio < 1 / REBAKE_THRESHOLD) {
        bakeLayer(layer, current)
        didRebake = true
      }
    }
    if (didRebake) scheduleDraw()
  }

  const scheduleRebake = () => {
    if (rebakeTimerRef.current !== null) window.clearTimeout(rebakeTimerRef.current)
    rebakeTimerRef.current = window.setTimeout(() => {
      rebakeTimerRef.current = null
      maybeRebake()
    }, REBAKE_IDLE_MS)
  }

  // -------- Transform updates ------------------------------------------------
  const setTransform = (next: Transform) => {
    const vp = viewportSizeRef.current
    const m = manifestRef.current
    if (!m) return
    transformRef.current = clampTransform(
      next,
      vp.w,
      vp.h,
      m.viewBox[2],
      m.viewBox[3],
      minScaleRef.current
    )
    scheduleDraw()
  }

  const zoomAt = (clientX: number, clientY: number, factor: number) => {
    const t = transformRef.current
    const viewport = viewportRef.current
    if (!viewport) return
    const rect = viewport.getBoundingClientRect()
    const px = clientX - rect.left
    const py = clientY - rect.top
    const newScale = t.scale * factor
    const worldX = (px - t.tx) / t.scale
    const worldY = (py - t.ty) / t.scale
    setTransform({
      tx: px - worldX * newScale,
      ty: py - worldY * newScale,
      scale: newScale
    })
    scheduleRebake()
  }

  // -------- Pointer + wheel handlers -----------------------------------------
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
      setTransform({
        tx: t.tx + (e.clientX - prev.x),
        ty: t.ty + (e.clientY - prev.y),
        scale: t.scale
      })
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
    if (pointersRef.current.size < 2) pinchStartRef.current = null
    if (pointersRef.current.size === 0) {
      setOverlayTick(t => t + 1)
      scheduleRebake()
    }
  }

  // Non-passive wheel listener so we can preventDefault (React's synthetic
  // wheel handler runs in passive mode). Re-runs when manifest loads since the
  // viewport <div> only mounts then. All state the handler reads lives in refs,
  // so the closure stays fresh across renders.
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
  }, [manifest])

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
    <main className="fixed inset-0 bg-rose-50/40 overflow-hidden">
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
        <canvas ref={canvasRef} className="block absolute top-0 left-0 w-full h-full" />
        {/*
          Station tap-target overlay. Sized to the master SVG dimensions, sharing the
          same transform as the canvas so absolute-positioned children (in master
          coords) stay aligned during pan/zoom. Empty for now — wire stations.json
          here in a follow-up.
        */}
        <div
          ref={overlayRef}
          className="absolute top-0 left-0 pointer-events-none origin-top-left"
          style={{
            width: manifest.viewBox[2],
            height: manifest.viewBox[3],
            transformOrigin: '0 0',
            willChange: 'transform'
          }}
        />
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

      {/* Debug panel: per-layer visibility toggles. */}
      <div className="absolute top-4 right-4 z-10">
        {debugPanelOpen
          ? (
              <div className="bg-white/95 backdrop-blur rounded-lg shadow-lg p-3 min-w-[160px]">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Layers</span>
                  <button
                    type="button"
                    onClick={() => setDebugPanelOpen(false)}
                    className="text-slate-400 hover:text-slate-700 leading-none text-lg cursor-pointer"
                    aria-label="Tutup panel debug"
                  >
                    ×
                  </button>
                </div>
                <ul className="flex flex-col gap-1">
                  {manifest.layers.map(layer => (
                    <li key={layer}>
                      <label className="flex items-center gap-2 cursor-pointer text-sm select-none">
                        <input
                          type="checkbox"
                          checked={layerVisibility[layer]}
                          onChange={e =>
                            setLayerVisibility(prev => ({ ...prev, [layer]: e.target.checked }))}
                          className="accent-rose-500"
                        />
                        <span>{LAYER_DEBUG_LABELS[layer]}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              </div>
            )
          : (
              <button
                type="button"
                onClick={() => setDebugPanelOpen(true)}
                className="bg-white/90 backdrop-blur rounded-full shadow-lg px-3 py-2 text-xs font-mono text-slate-600 hover:bg-white cursor-pointer"
                aria-label="Buka panel debug"
              >
                debug
              </button>
            )}
      </div>
    </main>
  )
}
