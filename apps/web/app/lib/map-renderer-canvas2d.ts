import type { Manifest, Point, Renderer, Tier, Transform } from './map-renderer'
import { tileKey } from './map-renderer'

interface TileEntry {
  bitmap: HTMLCanvasElement | OffscreenCanvas | ImageBitmap | null
  tier: Tier | 0
  pendingTier: Tier | null
}

function loadSourceImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const decoded = img.decode ? img.decode() : Promise.resolve()
      decoded.then(() => resolve(img)).catch(() => resolve(img))
    }
    img.onerror = () => reject(new Error(`Failed to load ${url}`))
    img.src = url
  })
}

function rasterize(srcImg: HTMLImageElement, tileW: number, tileH: number, tier: Tier): HTMLCanvasElement | OffscreenCanvas {
  const w = Math.round(tileW * tier)
  const h = Math.round(tileH * tier)
  const offscreen: HTMLCanvasElement | OffscreenCanvas
    = typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(w, h)
      : Object.assign(document.createElement('canvas'), { width: w, height: h })
  if (offscreen instanceof HTMLCanvasElement) {
    offscreen.width = w
    offscreen.height = h
  }
  const ctx = offscreen.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null
  if (!ctx) throw new Error('2D context unavailable for rasterization')
  ctx.drawImage(srcImg, 0, 0, w, h)
  return offscreen
}

export function createCanvas2DRenderer(
  canvas: HTMLCanvasElement,
  manifest: Manifest,
  baseUrl: string,
  onDirty: () => void
): Renderer {
  const rawCtx = canvas.getContext('2d')
  if (!rawCtx) throw new Error('2D canvas context unavailable')
  const ctx: CanvasRenderingContext2D = rawCtx

  const { grid, tileSize } = manifest
  const tileW = tileSize.w
  const tileH = tileSize.h

  const sourceImages = new Map<string, HTMLImageElement>()
  const tiles = new Map<string, TileEntry>()
  let disposed = false
  let points: Point[] = []
  let debugHitboxes = false

  function ensureTile(r: number, c: number): TileEntry {
    const key = tileKey(r, c)
    let entry = tiles.get(key)
    if (!entry) {
      entry = { bitmap: null, tier: 0, pendingTier: null }
      tiles.set(key, entry)
    }
    return entry
  }

  async function loadSource(r: number, c: number): Promise<HTMLImageElement> {
    const key = tileKey(r, c)
    const cached = sourceImages.get(key)
    if (cached) return cached
    const img = await loadSourceImage(`${baseUrl}tile-${r}-${c}.svg`)
    sourceImages.set(key, img)
    return img
  }

  async function requestTier(r: number, c: number, tier: Tier): Promise<void> {
    if (disposed) return
    const entry = ensureTile(r, c)
    if (entry.tier >= tier) return
    if (entry.pendingTier !== null && entry.pendingTier >= tier) return
    entry.pendingTier = tier
    try {
      const src = await loadSource(r, c)
      if (disposed) return
      if (entry.pendingTier !== tier) return
      const raster = rasterize(src, tileW, tileH, tier)
      if (disposed) return
      if (entry.pendingTier !== tier) return
      entry.bitmap = raster
      entry.tier = tier
      entry.pendingTier = null
      onDirty()
    } catch (err) {
      entry.pendingTier = null
      console.warn(`Tile ${r},${c} tier ${tier} rasterization failed`, err)
    }
  }

  function resize(cssW: number, cssH: number, dpr: number) {
    const w = Math.max(1, Math.round(cssW * dpr))
    const h = Math.max(1, Math.round(cssH * dpr))
    if (canvas.width !== w) canvas.width = w
    if (canvas.height !== h) canvas.height = h
  }

  function draw(transform: Transform, cssW: number, cssH: number, dpr: number, currentTier: Tier) {
    if (disposed) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, cssW, cssH)
    ctx.translate(transform.tx, transform.ty)
    ctx.scale(transform.scale, transform.scale)
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'

    const invScale = 1 / transform.scale
    const worldMinX = -transform.tx * invScale
    const worldMinY = -transform.ty * invScale
    const worldMaxX = (cssW - transform.tx) * invScale
    const worldMaxY = (cssH - transform.ty) * invScale

    for (let r = 0; r < grid.rows; r++) {
      const tileY = r * tileH
      if (tileY + tileH < worldMinY || tileY > worldMaxY) continue
      for (let c = 0; c < grid.cols; c++) {
        const tileX = c * tileW
        if (tileX + tileW < worldMinX || tileX > worldMaxX) continue
        const entry = ensureTile(r, c)
        if (entry.bitmap) {
          ctx.drawImage(entry.bitmap as CanvasImageSource, tileX, tileY, tileW, tileH)
        }
        if (entry.tier < currentTier && entry.pendingTier !== currentTier) {
          requestTier(r, c, currentTier)
        }
      }
    }

    if (debugHitboxes && points.length > 0) {
      ctx.fillStyle = 'rgba(255, 0, 153, 0.3)'
      for (const p of points) {
        drawCapsule(ctx, p.ax, p.ay, p.bx, p.by, p.r)
        ctx.fill()
      }
    }
  }

  function setPoints(next: Point[]) {
    points = next
    onDirty()
  }

  function setDebugHitboxes(enabled: boolean) {
    debugHitboxes = enabled
    onDirty()
  }

  function dispose() {
    if (disposed) return
    disposed = true
    tiles.clear()
    sourceImages.clear()
  }

  for (let r = 0; r < grid.rows; r++) {
    for (let c = 0; c < grid.cols; c++) {
      requestTier(r, c, 1)
    }
  }

  return {
    kind: 'canvas2d',
    draw,
    resize,
    requestTier: (r, c, tier) => { void requestTier(r, c, tier) },
    setPoints,
    setDebugHitboxes,
    dispose
  }
}

function drawCapsule(ctx: CanvasRenderingContext2D, ax: number, ay: number, bx: number, by: number, r: number) {
  const dx = bx - ax
  const dy = by - ay
  const len = Math.hypot(dx, dy)
  ctx.beginPath()
  if (len < 1e-6) {
    ctx.arc(ax, ay, r, 0, Math.PI * 2)
    return
  }
  const nx = -dy / len
  const ny = dx / len
  const ang = Math.atan2(dy, dx)
  ctx.moveTo(ax + nx * r, ay + ny * r)
  ctx.lineTo(bx + nx * r, by + ny * r)
  ctx.arc(bx, by, r, ang + Math.PI / 2, ang - Math.PI / 2)
  ctx.lineTo(ax - nx * r, ay - ny * r)
  ctx.arc(ax, ay, r, ang - Math.PI / 2, ang + Math.PI / 2)
  ctx.closePath()
}
