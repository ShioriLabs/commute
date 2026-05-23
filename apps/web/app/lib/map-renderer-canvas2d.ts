import type { Manifest, Point, Renderer, Tier, Transform } from './map-renderer'
import { tileKey } from './map-renderer'
import { createTileSource } from './map-renderer-tile-source'

interface TileEntry {
  bitmap: ImageBitmap | null
  tier: Tier | 0
  pendingTier: Tier | null
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
  const mapW = grid.cols * tileW
  const mapH = grid.rows * tileH

  const tileSource = createTileSource({ manifest, baseUrl })
  const tiles = new Map<string, TileEntry>()
  let disposed = false
  let points: Point[] = []
  let debugHitboxes = false

  // Preview bitmap painted under the tile grid until all visible tiles have
  // loaded. Released (set to null) once it's no longer needed so the GC can
  // reclaim the memory.
  let preview: ImageBitmap | null = null
  let previewLoading = false

  function ensureTile(r: number, c: number): TileEntry {
    const key = tileKey(r, c)
    let entry = tiles.get(key)
    if (!entry) {
      entry = { bitmap: null, tier: 0, pendingTier: null }
      tiles.set(key, entry)
    }
    return entry
  }

  async function requestTier(r: number, c: number, tier: Tier): Promise<void> {
    if (disposed) return
    const entry = ensureTile(r, c)
    if (entry.tier >= tier) return
    if (entry.pendingTier !== null && entry.pendingTier >= tier) return
    entry.pendingTier = tier
    try {
      const bitmap = await tileSource.loadTile(r, c, tier)
      if (disposed) {
        bitmap.close?.()
        return
      }
      if (entry.pendingTier !== tier) {
        // A higher-tier request superseded this one; drop our bitmap.
        bitmap.close?.()
        return
      }
      const old = entry.bitmap
      entry.bitmap = bitmap
      entry.tier = tier
      entry.pendingTier = null
      old?.close?.()
      onDirty()
    } catch (err) {
      entry.pendingTier = null
      console.warn(`Tile ${r},${c} tier ${tier} load failed`, err)
    }
  }

  function ensurePreview() {
    if (preview || previewLoading || !manifest.preview) return
    previewLoading = true
    tileSource.loadPreview().then((bitmap) => {
      previewLoading = false
      if (disposed) {
        bitmap?.close?.()
        return
      }
      if (!bitmap) return
      preview = bitmap
      onDirty()
    }).catch(() => {
      previewLoading = false
    })
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

    // Underlay preview if any visible tile is missing. Cheap full-map draw
    // covers blank areas while real tiles load in.
    let anyVisibleMissing = false
    for (let r = 0; r < grid.rows && !anyVisibleMissing; r++) {
      const tileY = r * tileH
      if (tileY + tileH < worldMinY || tileY > worldMaxY) continue
      for (let c = 0; c < grid.cols; c++) {
        const tileX = c * tileW
        if (tileX + tileW < worldMinX || tileX > worldMaxX) continue
        const entry = ensureTile(r, c)
        if (entry.tier === 0) {
          anyVisibleMissing = true
          break
        }
      }
    }
    if (anyVisibleMissing && preview) {
      ctx.drawImage(preview, 0, 0, mapW, mapH)
    } else if (preview && !anyVisibleMissing) {
      // All visible tiles loaded; release the preview.
      preview.close?.()
      preview = null
    }

    for (let r = 0; r < grid.rows; r++) {
      const tileY = r * tileH
      if (tileY + tileH < worldMinY || tileY > worldMaxY) continue
      for (let c = 0; c < grid.cols; c++) {
        const tileX = c * tileW
        if (tileX + tileW < worldMinX || tileX > worldMaxX) continue
        const entry = ensureTile(r, c)
        if (entry.bitmap) {
          ctx.drawImage(entry.bitmap, tileX, tileY, tileW, tileH)
        }
        if (entry.tier < currentTier && entry.pendingTier !== currentTier) {
          void requestTier(r, c, currentTier)
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
    for (const entry of tiles.values()) {
      entry.bitmap?.close?.()
    }
    tiles.clear()
    preview?.close?.()
    preview = null
    tileSource.dispose()
  }

  ensurePreview()

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
