import type { Manifest, Point, Renderer, SelectionOverlay, Tier, Transform } from './map-renderer'
import { RING_WIDTH_WORLD, SPOTLIGHT_FEATHER_WORLD, pointCornerRadius, ringOffsetWorld, tileKey } from './map-renderer'
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

  // Offscreen canvas for the selection scrim. The punch-out uses
  // destination-out compositing, which would erase the map if done on the
  // main canvas — so the scrim is composed here and drawn over in one blit.
  const scrimCanvas = document.createElement('canvas')
  const scrimCtx = scrimCanvas.getContext('2d')

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
    if (scrimCanvas.width !== w) scrimCanvas.width = w
    if (scrimCanvas.height !== h) scrimCanvas.height = h
  }

  function drawSelection(sel: SelectionOverlay, transform: Transform, cssW: number, cssH: number, dpr: number) {
    if (sel.scrimAlpha > 0 && scrimCtx) {
      if (scrimCanvas.width !== canvas.width) scrimCanvas.width = canvas.width
      if (scrimCanvas.height !== canvas.height) scrimCanvas.height = canvas.height
      scrimCtx.setTransform(1, 0, 0, 1, 0, 0)
      scrimCtx.clearRect(0, 0, scrimCanvas.width, scrimCanvas.height)
      scrimCtx.setTransform(dpr, 0, 0, dpr, 0, 0)
      scrimCtx.fillStyle = `rgba(15, 23, 42, ${sel.scrimAlpha})`
      scrimCtx.fillRect(0, 0, cssW, cssH)
      scrimCtx.translate(transform.tx, transform.ty)
      scrimCtx.scale(transform.scale, transform.scale)
      // Feathered punch-out: accumulate partial erases over shrinking radii,
      // then hard-clear the capsule interior.
      scrimCtx.globalCompositeOperation = 'destination-out'
      const steps = 5
      for (let i = steps; i >= 1; i--) {
        scrimCtx.fillStyle = `rgba(0, 0, 0, ${Math.min(1, (1 / steps) * 1.2)})`
        drawShape(scrimCtx, sel.ax, sel.ay, sel.bx, sel.by, sel.r, sel.cr, SPOTLIGHT_FEATHER_WORLD * (i / steps))
        scrimCtx.fill()
      }
      scrimCtx.fillStyle = 'rgba(0, 0, 0, 1)'
      drawShape(scrimCtx, sel.ax, sel.ay, sel.bx, sel.by, sel.r, sel.cr)
      scrimCtx.fill()
      scrimCtx.globalCompositeOperation = 'source-over'

      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.drawImage(scrimCanvas, 0, 0)
      // Restore world transform for the halo below.
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.translate(transform.tx, transform.ty)
      ctx.scale(transform.scale, transform.scale)
    }

    if (sel.ringProgress > 0) {
      const r = Math.round(sel.color[0] * 255)
      const g = Math.round(sel.color[1] * 255)
      const b = Math.round(sel.color[2] * 255)
      ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${sel.ringProgress})`
      ctx.lineWidth = RING_WIDTH_WORLD
      ctx.shadowColor = `rgba(${r}, ${g}, ${b}, ${sel.ringProgress})`
      ctx.shadowBlur = 12 * transform.scale
      drawShape(ctx, sel.ax, sel.ay, sel.bx, sel.by, sel.r, sel.cr, ringOffsetWorld(sel.ringProgress))
      ctx.stroke()
      ctx.shadowColor = 'transparent'
      ctx.shadowBlur = 0
    }
  }

  function draw(transform: Transform, cssW: number, cssH: number, dpr: number, currentTier: Tier, selection?: SelectionOverlay | null) {
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
        drawShape(ctx, p.ax, p.ay, p.bx, p.by, p.r, pointCornerRadius(p))
        ctx.fill()
      }
    }

    if (selection && (selection.scrimAlpha > 0 || selection.ringProgress > 0)) {
      drawSelection(selection, transform, cssW, cssH, dpr)
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

// Path for a point's shape: an oriented rounded rect along the a→b axis with
// half-width r and corner radius cr (cr = r degenerates to a capsule).
// `pad` grows the shape outward uniformly (Minkowski sum: extents and corner
// radius both grow by pad) — used for the spotlight's feather and halo ring.
// Path coordinates are baked under a temporary translate/rotate, so the
// canvas transform is unchanged when this returns.
function drawShape(
  ctx: CanvasRenderingContext2D,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  r: number,
  cr: number,
  pad = 0
) {
  const dx = bx - ax
  const dy = by - ay
  const len = Math.hypot(dx, dy)
  const angle = len > 1e-6 ? Math.atan2(dy, dx) : 0
  const hw = len / 2 + r + pad
  const hh = r + pad
  const rad = Math.max(0, Math.min(cr + pad, hh))
  ctx.save()
  ctx.translate((ax + bx) / 2, (ay + by) / 2)
  ctx.rotate(angle)
  ctx.beginPath()
  ctx.moveTo(-hw + rad, -hh)
  ctx.lineTo(hw - rad, -hh)
  ctx.arcTo(hw, -hh, hw, -hh + rad, rad)
  ctx.lineTo(hw, hh - rad)
  ctx.arcTo(hw, hh, hw - rad, hh, rad)
  ctx.lineTo(-hw + rad, hh)
  ctx.arcTo(-hw, hh, -hw, hh - rad, rad)
  ctx.lineTo(-hw, -hh + rad)
  ctx.arcTo(-hw, -hh, -hw + rad, -hh, rad)
  ctx.closePath()
  ctx.restore()
}
