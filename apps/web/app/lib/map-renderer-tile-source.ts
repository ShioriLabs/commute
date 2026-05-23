import type { Manifest, Tier } from './map-renderer'
import type { RasterizeRequest, RasterizeResponse } from './map-renderer-worker'

/*
 * Tile-source abstraction shared by both Canvas2D and WebGL renderers.
 *
 * Resolution order for a tile at a given tier:
 *   1. If manifest.raster lists this tier, fetch the pre-rasterized WebP and
 *      decode via createImageBitmap. This is the hot path on mobile — no SVG
 *      parse, no main-thread drawImage.
 *   2. Otherwise, fetch the SVG text on the main thread (so the SW cache is
 *      consulted) and hand it to the OffscreenCanvas worker, which decodes
 *      and rasterizes off-thread.
 *   3. If the worker isn't available (very old Safari without Worker or
 *      OffscreenCanvas), rasterize synchronously on the main thread as a
 *      last resort.
 *
 * Output is always an ImageBitmap, which both ctx.drawImage and
 * gl.texImage2D consume directly.
 */

type Bitmap = ImageBitmap

const canUseWorker = typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined'

interface PendingRequest {
  resolve: (b: Bitmap) => void
  reject: (e: Error) => void
}

class RasterWorker {
  private worker: Worker | null = null
  private nextId = 1
  private pending = new Map<number, PendingRequest>()

  private ensure(): Worker | null {
    if (!canUseWorker) return null
    if (this.worker) return this.worker
    try {
      // Vite resolves this `new URL(..., import.meta.url)` to a built worker
      // bundle (see https://vite.dev/guide/features.html#web-workers).
      this.worker = new Worker(
        new URL('./map-renderer-worker.ts', import.meta.url),
        { type: 'module' }
      )
      this.worker.addEventListener('message', (e: MessageEvent<RasterizeResponse>) => {
        const { id } = e.data
        const p = this.pending.get(id)
        if (!p) return
        this.pending.delete(id)
        if ('bitmap' in e.data) p.resolve(e.data.bitmap)
        else p.reject(new Error(e.data.error))
      })
      this.worker.addEventListener('error', (e) => {
        // Reject all pending so callers fall back to the sync path.
        for (const p of this.pending.values()) {
          p.reject(new Error(e.message || 'worker error'))
        }
        this.pending.clear()
        this.worker = null
      })
    } catch (err) {
      console.warn('[map] rasterize worker unavailable, using sync fallback', err)
      this.worker = null
    }
    return this.worker
  }

  rasterize(svgText: string, w: number, h: number): Promise<Bitmap> | null {
    const worker = this.ensure()
    if (!worker) return null
    return new Promise<Bitmap>((resolve, reject) => {
      const id = this.nextId++
      this.pending.set(id, { resolve, reject })
      const req: RasterizeRequest = { id, svgText, w, h }
      worker.postMessage(req)
    })
  }

  dispose() {
    if (this.worker) {
      this.worker.terminate()
      this.worker = null
    }
    this.pending.clear()
  }
}

async function rasterizeSvgSync(svgText: string, w: number, h: number): Promise<Bitmap> {
  // Fallback for environments without Worker/OffscreenCanvas. Still decodes
  // off-thread via createImageBitmap, just doesn't isolate the resize.
  const blob = new Blob([svgText], { type: 'image/svg+xml' })
  return await createImageBitmap(blob, {
    resizeWidth: w,
    resizeHeight: h,
    resizeQuality: 'high'
  })
}

export interface TileSourceOptions {
  manifest: Manifest
  baseUrl: string
}

export interface TileSource {
  loadTile(r: number, c: number, tier: Tier): Promise<Bitmap>
  loadPreview(): Promise<Bitmap | null>
  dispose(): void
}

export function createTileSource({ manifest, baseUrl }: TileSourceOptions): TileSource {
  const tileW = manifest.tileSize.w
  const tileH = manifest.tileSize.h
  const rasterTiers = new Set<Tier>(manifest.raster?.tiers ?? [])
  const worker = new RasterWorker()
  // Cache SVG text per (r,c) so tier upgrades don't re-fetch.
  const svgTextCache = new Map<string, Promise<string>>()

  async function fetchText(url: string): Promise<string> {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`)
    return await res.text()
  }

  async function loadRasterTile(r: number, c: number, tier: Tier): Promise<Bitmap> {
    const url = `${baseUrl}tile-${r}-${c}@${tier}x.webp`
    const res = await fetch(url)
    if (!res.ok) throw new Error(`Raster tile fetch failed: ${url} (${res.status})`)
    const blob = await res.blob()
    return await createImageBitmap(blob)
  }

  async function loadSvgTile(r: number, c: number, tier: Tier): Promise<Bitmap> {
    const key = `${r}-${c}`
    let textPromise = svgTextCache.get(key)
    if (!textPromise) {
      textPromise = fetchText(`${baseUrl}tile-${r}-${c}.svg`)
      svgTextCache.set(key, textPromise)
    }
    const text = await textPromise
    const w = Math.round(tileW * tier)
    const h = Math.round(tileH * tier)
    const viaWorker = worker.rasterize(text, w, h)
    if (viaWorker) return await viaWorker
    return await rasterizeSvgSync(text, w, h)
  }

  async function loadTile(r: number, c: number, tier: Tier): Promise<Bitmap> {
    if (rasterTiers.has(tier)) {
      try {
        return await loadRasterTile(r, c, tier)
      } catch (err) {
        console.warn(`[map] raster tier ${tier} unavailable for ${r},${c}; falling back to SVG`, err)
        return await loadSvgTile(r, c, tier)
      }
    }
    return await loadSvgTile(r, c, tier)
  }

  async function loadPreview(): Promise<Bitmap | null> {
    const preview = manifest.preview
    if (!preview) return null
    try {
      const res = await fetch(`${baseUrl}${preview.url}`)
      if (!res.ok) return null
      const blob = await res.blob()
      return await createImageBitmap(blob)
    } catch (err) {
      console.warn('[map] preview load failed', err)
      return null
    }
  }

  function dispose() {
    worker.dispose()
    svgTextCache.clear()
  }

  return { loadTile, loadPreview, dispose }
}
