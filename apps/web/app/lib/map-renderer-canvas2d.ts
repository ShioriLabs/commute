import type { Manifest, Point, Renderer, RouteDrawItem, RouteOverlay, RouteOverlayFrame, SelectionOverlay, Tier, TileStats, Transform } from './map-renderer'
import { RING_WIDTH_WORLD, mapTreatment, pointCornerRadius, ringOffsetWorld, routeDrawItems, tileKey } from './map-renderer'
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
  let routeItems: RouteDrawItem[] = []

  // Preview bitmap painted under the tile grid whenever a visible tile has no
  // pixels yet. Held until dispose() — see the note in draw().
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
      const { bitmap } = await tileSource.loadTile(r, c, tier)
      if (disposed) {
        bitmap.close?.()
        return
      }
      // Identity re-check, not just pendingTier: releaseTiles() can drop this
      // entry while the fetch is in flight, and the replacement is a different
      // object with pendingTier === null. Without this the bitmap would be
      // stored on a detached entry and leak until GC.
      if (tiles.get(tileKey(r, c)) !== entry) {
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

  // The halo, and only the halo. Isolating the selection is the tile pass's job
  // now (see drawTiles) — a fade has to be cancelled where it is applied, and
  // the offscreen destination-out canvas this used to need went with the scrim.
  function drawSelection(sel: SelectionOverlay, transform: Transform) {
    if (sel.ringProgress <= 0) return
    const r = Math.round(sel.color[0] * 255)
    const g = Math.round(sel.color[1] * 255)
    const b = Math.round(sel.color[2] * 255)
    const ringColor = `rgba(${r}, ${g}, ${b}, ${sel.ringProgress})`
    ctx.strokeStyle = ringColor
    ctx.lineWidth = RING_WIDTH_WORLD
    ctx.shadowColor = ringColor
    ctx.shadowBlur = 12 * transform.scale
    drawShape(ctx, sel.ax, sel.ay, sel.bx, sel.by, sel.r, sel.cr, ringOffsetWorld(sel.ringProgress))
    ctx.stroke()
    ctx.shadowColor = 'transparent'
    ctx.shadowBlur = 0
  }

  /*
   * The visible tiles, drawn under whatever ctx.filter is currently set.
   *
   * Extracted because the cutout has to draw the same tiles a second time at a
   * different filter strength. `requestUpgrades` is false on those repeat passes:
   * the first pass over the same region already asked for any tier upgrade, and
   * re-asking per feather ring would fire the same fetch several times a frame.
   */
  function drawTiles(
    worldMinX: number, worldMinY: number, worldMaxX: number, worldMaxY: number,
    currentTier: Tier, requestUpgrades: boolean
  ) {
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
        if (requestUpgrades && entry.tier < currentTier && entry.pendingTier !== currentTier) {
          void requestTier(r, c, currentTier)
        }
      }
    }
  }

  function draw(transform: Transform, cssW: number, cssH: number, dpr: number, currentTier: Tier, selection?: SelectionOverlay | null, route?: RouteOverlayFrame | null) {
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
    /*
     * Drain the map's colour while a route is drawn, so the route's own colours
     * are the only saturated thing on screen. The WebGL path does this in the
     * tile shader; here the filter is the only tool available, and it wraps both
     * the underlay and the tile loop so the two never disagree mid-load.
     *
     * ctx.filter is the slow canvas2d path — an intermediate surface per
     * drawImage. Acceptable because this renderer is the WebGL2 fallback and a
     * shown route is a near-static camera. It is also unsupported on older
     * Safari, where it no-ops into today's full-colour map rather than breaking.
     */
    const treatment = mapTreatment(selection, route)
    const desat = treatment.desaturate
    const fade = treatment.fade
    const cut = treatment.cut
    /*
     * `opacity()` rather than a white overlay: the tiles are drawn straight onto
     * the already-white canvas, so thinning them toward it IS the blend the
     * WebGL path does with mix(rgb, white, u_fade) — and it needs no extra fill
     * pass that the route would then have to be drawn over.
     */
    if (desat > 0 || fade > 0) {
      ctx.filter = `saturate(${1 - desat}) opacity(${1 - fade})`
    }

    // Kept resident for the renderer's whole life — see the matching comment in
    // map-renderer-webgl.ts. releaseTiles() resets every tile to tier 0, and
    // this underlay is what covers the refill.
    if (anyVisibleMissing) {
      if (!preview) ensurePreview()
      if (preview) ctx.drawImage(preview, 0, 0, mapW, mapH)
    }

    drawTiles(worldMinX, worldMinY, worldMaxX, worldMaxY, currentTier, true)

    // Back to full strength before anything but map artwork is drawn. ctx.filter
    // is sticky across draw calls, so without this the route, its pins and the
    // selection spotlight would be faded and desaturated too — which would erase
    // the one distinction the treatment exists to create.
    if (desat > 0 || fade > 0) ctx.filter = 'none'

    /*
     * The selection cutout: the tapped station's own pixels, put back at full
     * strength on top of the faded pass above.
     *
     * The WebGL path masks the fade inside the tile shader, one pass. Here
     * ctx.filter applies to a whole drawImage and cannot be masked within it, so
     * the only equivalent is to draw the affected tiles a second time unfiltered
     * behind a clip. Bounded to the tiles the shape actually touches — a point
     * is at most ~212 world units end to end, so this is one to four tiles, not
     * the grid.
     *
     * The clip is hard-edged where the shader's is feathered, so the fade is
     * stepped back over a few shrinking rings to approximate it. That is the
     * same trick the destination-out punch-out used before this, for the same
     * reason: canvas2d has no smoothstep.
     */
    if (cut.feather > 0 && (desat > 0 || fade > 0)) {
      const pad = cut.feather
      const minX = Math.min(cut.ax, cut.bx) - cut.r - pad
      const maxX = Math.max(cut.ax, cut.bx) + cut.r + pad
      const minY = Math.min(cut.ay, cut.by) - cut.r - pad
      const maxY = Math.max(cut.ay, cut.by) + cut.r + pad
      // Skip entirely when the selection is off screen: the clip would draw
      // nothing, but the tile fetches it triggers are not free.
      if (maxX >= worldMinX && minX <= worldMaxX && maxY >= worldMinY && minY <= worldMaxY) {
        const steps = 4
        for (let i = steps; i >= 0; i--) {
          // Ring i sits at i/steps of the way out through the feather, and is
          // drawn at the fade strength that ring should end up showing.
          const t = i / steps
          const ringDesat = desat * t
          const ringFade = fade * t
          ctx.save()
          drawShape(ctx, cut.ax, cut.ay, cut.bx, cut.by, cut.r, cut.cr, pad * t)
          ctx.clip()
          ctx.filter = ringDesat > 0 || ringFade > 0
            ? `saturate(${1 - ringDesat}) opacity(${1 - ringFade})`
            : 'none'
          drawTiles(
            Math.max(worldMinX, minX), Math.max(worldMinY, minY),
            Math.min(worldMaxX, maxX), Math.min(worldMaxY, maxY),
            currentTier, false
          )
          ctx.filter = 'none'
          ctx.restore()
        }
      }
    }

    if (route && route.alpha > 0 && routeItems.length > 0) {
      // Flat dim under the route — no punch-out; the route's opaque capsules
      // sit on top and pop against it. Same slate as the selection scrim.
      if (route.scrimAlpha > 0) {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
        ctx.fillStyle = `rgba(15, 23, 42, ${route.scrimAlpha})`
        ctx.fillRect(0, 0, cssW, cssH)
        ctx.translate(transform.tx, transform.ty)
        ctx.scale(transform.scale, transform.scale)
      }
      for (const item of routeItems) {
        const r = Math.round(item.color[0] * 255)
        const g = Math.round(item.color[1] * 255)
        const b = Math.round(item.color[2] * 255)
        ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${route.alpha})`
        // cr = r degenerates the rounded rect to a capsule; pin items have
        // coincident endpoints and come out as discs.
        drawShape(ctx, item.ax, item.ay, item.bx, item.by, item.r, item.r)
        ctx.fill()
      }
    }

    if (debugHitboxes && points.length > 0) {
      ctx.fillStyle = 'rgba(255, 0, 153, 0.3)'
      for (const p of points) {
        drawShape(ctx, p.ax, p.ay, p.bx, p.by, p.r, pointCornerRadius(p))
        ctx.fill()
      }
    }

    if (selection && selection.ringProgress > 0) {
      drawSelection(selection, transform)
    }
  }

  function setPoints(next: Point[]) {
    points = next
    onDirty()
  }

  function setRouteOverlay(route: RouteOverlay | null) {
    routeItems = route ? routeDrawItems(route) : []
    onDirty()
  }

  function setDebugHitboxes(enabled: boolean) {
    debugHitboxes = enabled
    onDirty()
  }

  // Mirrors the WebGL renderer: drop the tile pixels, keep the renderer usable.
  // ImageBitmaps are often GPU-backed too, so this is worth doing here as well.
  function releaseTiles() {
    if (disposed) return
    for (const entry of tiles.values()) entry.bitmap?.close?.()
    tiles.clear()
    onDirty()
  }

  function tileStats(): TileStats {
    let bytes = 0
    for (const entry of tiles.values()) {
      if (entry.bitmap) bytes += entry.bitmap.width * entry.bitmap.height * 4
    }
    return { count: tiles.size, bytes }
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
    setRouteOverlay,
    setDebugHitboxes,
    // A 2D context is never "lost" in the WebGL sense — the browser silently
    // reallocates its backing store — so there is nothing to recover from.
    isContextLost: () => false,
    releaseTiles,
    isPreviewReady: () => preview !== null,
    tileStats,
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
