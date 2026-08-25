import { createWebGLRenderer } from './map-renderer-webgl'
import { createCanvas2DRenderer } from './map-renderer-canvas2d'

export interface Manifest {
  version: string
  // Short content hash over the emitted rasters, appended to tile URLs as `?v=`.
  // `version` tracks the source PDF edition and stays put when the same artwork
  // is re-tiled, which is what let a new manifest point at year-old cached tiles
  // at the edge. Optional so a manifest built before this field still loads —
  // those URLs simply go unversioned, exactly as they did then.
  build?: string
  source: string
  viewBox: [number, number, number, number]
  grid: { rows: number, cols: number }
  tileSize: { w: number, h: number }
  raster?: {
    format: 'webp'
    tiers: Tier[]
  }
  preview?: {
    url: string
    w: number
    h: number
  }
}

export type Transform = { tx: number, ty: number, scale: number }

// Raster scale relative to the SVG's intrinsic tile size. 0.5 is a genuine
// half-resolution tier, not a placeholder: between the preview handoff and ~4x
// zoom a tile is minified 2.2-7x, so a half-res texture still supplies more
// texels than the screen shows while costing a quarter of the pixels. That band
// is the memory peak — it is where the whole grid is resident at once.
export type Tier = 0.5 | 1 | 2 | 4

export const TIERS: Tier[] = [0.5, 1, 2, 4]
export const MAX_TIER: Tier = 4
// Coarsest tier available. Distinct from the `0` that TileEntry.tier uses to
// mean "no pixels uploaded yet" — 0.5 is a real, drawable texture.
export const MIN_TIER: Tier = 0.5

// Tap-target shape: an oriented rounded rectangle. `ax,ay → bx,by` is the
// centerline, `r` the half-width, and the bounding box extends `r` past both
// endpoints (identical footprint to the old capsules). `cr` is the corner
// radius in world units; omitted (or >= r) it degenerates to a capsule, so
// every pre-`cr` points.json entry keeps its exact old shape. Hubs on the
// FDTJ map are drawn as rounded rects — author those with a small `cr`.
// `id` is the point's unique key — one per drawn shape. `station` names the
// station it opens (`OPERATOR-CODE`) when that differs from `id`: the schematic
// draws a few haltes in more than one place (e.g. Flyover Jatinegara has both a
// teardrop and a bar), and each shape needs its own `id` while resolving to the
// same station. Omit it and the id doubles as the station, as it always has.
export interface Point {
  id: string
  station?: string
  ax: number
  ay: number
  bx: number
  by: number
  r: number
  cr?: number
  /*
   * Suppress the selection halo for this shape, keeping only the scrim.
   *
   * The ring is drawn as an offset outline that settles onto the pill's own
   * edge, which reads as a highlight around a marker but as a box drawn around
   * a word — the artwork already gives a station name no outline of its own, so
   * ringing it looks like a rendering artefact rather than a selection. A
   * scrim-only spotlight still isolates the tapped label perfectly well.
   */
  noRing?: boolean
}

// Effective corner radius: clamped to [0, r]; missing means fully rounded.
export function pointCornerRadius(p: Point): number {
  return Math.max(0, Math.min(p.cr ?? p.r, p.r))
}

// The `OPERATOR-CODE` this point opens. Use this — never `p.id` — whenever the
// station identity is what matters; extra dots for one station carry synthetic
// ids (`TJ-H00037C-b`) that would not parse into a real code.
export function pointStationId(p: Point): string {
  return p.station ?? p.id
}

export interface PointsManifest {
  version: string
  points: Point[]
}

// Spotlight overlay for the currently selected station/hub: a dimming scrim
// with a feathered punch-out around the capsule, plus a glowing halo ring in
// the selection's line color. The renderers are stateless with respect to
// time — map.tsx animates scrimAlpha/ringProgress and passes current values.
export interface SelectionOverlay {
  ax: number
  ay: number
  bx: number
  by: number
  r: number
  cr: number // effective corner radius (see pointCornerRadius)
  color: [number, number, number] // 0..1 rgb
  scrimAlpha: number // 0..SCRIM_MAX_ALPHA, current animated value
  ringProgress: number // 0..1: drives ring offset (settle-in) and alpha
}

export const SCRIM_MAX_ALPHA = 0.32
// World units so the spotlight stays "attached to the map" across zoom.
export const SPOTLIGHT_FEATHER_WORLD = 26
export const RING_WIDTH_WORLD = 5
// Ring animates from MAX offset (outside) down to REST as ringProgress → 1.
export const RING_MAX_OFFSET_WORLD = 30
export const RING_REST_OFFSET_WORLD = 8

export function ringOffsetWorld(ringProgress: number): number {
  return RING_MAX_OFFSET_WORLD + (RING_REST_OFFSET_WORLD - RING_MAX_OFFSET_WORLD) * ringProgress
}

// Route overlay: the fare pair drawn on the map — a polyline through station
// centroids per ride leg, dashed connectors for transfers, and origin/
// destination pins. Same doctrine as the selection overlay: geometry is pushed
// statefully via setRouteOverlay, while map.tsx animates the frame values and
// passes them per draw.
export interface RouteSegment {
  ax: number
  ay: number
  bx: number
  by: number
  r: number // half-width, world units
  color: [number, number, number] // 0..1 rgb
  kind: 'ride' | 'transfer'
}

export interface RoutePin {
  x: number
  y: number
  kind: 'origin' | 'destination' | 'stop'
  // Only for 'stop': the colour of the leg being ridden through it, so an
  // intermediate station reads as a dot ON that line — Manggarai is blue when
  // you are riding Cikarang through it. The ends are ink-coloured regardless,
  // since they belong to the journey rather than to either line.
  color?: [number, number, number]
  // Outer disc radius, world units. Set when the leg is drawn at a non-default
  // width (BRT) so the marker stays in proportion to its line; defaults to the
  // rail size.
  r?: number
}

export interface RouteOverlay {
  // Transfers arrive pre-dashed (dashSegment), so renderers draw every entry
  // the same way and need no dash logic of their own.
  segments: RouteSegment[]
  pins: RoutePin[]
}

export interface RouteOverlayFrame {
  alpha: number // 0..1 whole-overlay fade
  scrimAlpha: number // 0..ROUTE_SCRIM_MAX_ALPHA flat dim under the route
  // 0..ROUTE_DESATURATE_MAX colour drained from the map tiles. Applies to the
  // artwork only — the route's own capsules and pins keep their colour, which is
  // the whole point.
  desaturate: number
  // 0..ROUTE_FADE_MAX of the artwork blended toward page white. Same scope as
  // `desaturate` — tiles only, never the route.
  fade: number
}

/*
 * The route separates from the map by draining the map's colour, not by dimming
 * it — see ROUTE_DESATURATE_MAX. So this is 0, and the scrim never draws.
 *
 * Kept rather than deleted because dim-vs-desaturate is a judgement that can only
 * really be made on a device: the whole mechanism (both renderers' scrim passes,
 * the shader, the buffers) survives behind one number, so revisiting it is an
 * edit here rather than a resurrection across two renderers.
 */
export const ROUTE_SCRIM_MAX_ALPHA = 0

/*
 * How much colour to drain from the map while a route is drawn, 0..1.
 *
 * Deliberately modest, because desaturation alone does NOT make a schematic
 * recede: it removes the hue that tells corridors apart while leaving every
 * stroke exactly as dark as it started, so the map goes from busy-and-coloured
 * to busy-and-grey. It was 0.85 on its own and the route had to fight the
 * artwork; the fade below is what actually clears the field, and this is now
 * only here to stop the surviving colour competing with the route's own.
 */
export const ROUTE_DESATURATE_MAX = 0.25

/*
 * How far to blend the map toward page white while a route is drawn, 0..1.
 *
 * This is the lever that makes the artwork recede — dropping contrast, not hue.
 * Paired with the light desaturation above, unrelated corridors go pastel and
 * stop competing while keeping just enough colour to still read as this map,
 * and the route's full-strength capsules become the only saturated thing on
 * screen. Fade does the receding; desaturate stops what is left competing, so
 * fade should stay the larger of the two.
 *
 * Short of 1 for the same reason as above: a blank page reads as a failed
 * render rather than a deliberate state. Chosen against the artwork rather than
 * by eye, but per the note on ROUTE_SCRIM_MAX_ALPHA this pair is still a
 * judgement best confirmed on a device.
 */
export const ROUTE_FADE_MAX = 0.6
/*
 * World units, like the spotlight constants, so the route stays glued to the
 * map across zoom instead of fattening as the view pulls out. The artwork's own
 * rail corridors are 25 world units wide, so the route line must beat 12.5
 * half-width to read over them — and at a fitted zoom (~0.16 scale) anything
 * much thinner dissolves into its own antialiasing feather.
 */
export const ROUTE_LINE_HALF_WIDTH_WORLD = 16
/*
 * BRT corridors are drawn at 15, not 25, so the rail width laid over one covers
 * it twice over and the route stops reading as "this line" and starts reading as
 * a highlighter smeared across the map.
 *
 * Scaled by the same 15/25 the artwork uses rather than picked by eye, so the
 * two match the sheet's own proportion. Still comfortably over the corridor's
 * own 7.5 half-width, which is what keeps it legible on top.
 */
export const ROUTE_LINE_HALF_WIDTH_BRT_WORLD = 10
export const ROUTE_CASING_EXTRA_WORLD = 3
export const ROUTE_TRANSFER_DASH_WORLD = 24
export const ROUTE_TRANSFER_GAP_WORLD = 14
export const ROUTE_PIN_RADIUS_WORLD = 26

// Pin styling, shared by both renderers via routeDrawItems. The dark ink
// matches the spotlight scrim so the overlay reads as one system.
const ROUTE_INK: [number, number, number] = [0.06, 0.09, 0.16]
const ROUTE_WHITE: [number, number, number] = [1, 1, 1]

/*
 * The ends are the same marker as an intermediate stop — white casing, the
 * ridden line's colour, white core — with an arrow struck through the core:
 * up for where the journey starts, down for where it ends.
 *
 * Drawn a size up from a plain stop so the ends still dominate the line, and
 * the glyph is built from capsules like everything else in the paint list, so
 * both renderers draw it verbatim with no shape primitive of their own.
 */
const ROUTE_PIN_INNER_WORLD = 17
// Half-height and half-width of the arrow's bounding box, world units. The
// chevron sits on the upper half of the shaft, which is what reads as a
// direction at a glance rather than as a plus sign.
const ROUTE_ARROW_HALF_H = 11
const ROUTE_ARROW_HALF_W = 8
const ROUTE_ARROW_HALF_WIDTH_WORLD = 2.6

/*
 * Intermediate stops: a marker at every station the route calls at, built like
 * the schematic's own — a white casing, the ridden line's colour, then a white
 * core, so what reads is a coloured ring.
 *
 * The outer disc has to beat ROUTE_LINE_HALF_WIDTH_WORLD (16) or there is no
 * coloured rim outside the line to see, and the marker collapses into a plain
 * white hole punched through the route. Still well under the end pins' 26, so
 * origin and destination stay the emphasis.
 */
export const ROUTE_STOP_RADIUS_WORLD = 20
// BRT's thinner line needs a proportionally smaller marker, or the dots stop
// punctuating the route and start swallowing it. Same 15/25 ratio the widths use.
export const ROUTE_STOP_RADIUS_BRT_WORLD = 13
// Inner core as a fraction of the outer disc, so both sizes read as the same
// marker rather than one looking like a ring and the other a dot.
const ROUTE_STOP_INNER_RATIO = 0.5

// One entry of the route overlay's paint list: an oriented capsule (degenerate
// — a == b — for pin discs). Renderers draw these verbatim, in order, so the
// WebGL and Canvas2D paths can't drift apart stylistically.
export interface RouteDrawItem {
  ax: number
  ay: number
  bx: number
  by: number
  r: number
  color: [number, number, number]
}

// Flatten an overlay into paint order: white casing under every segment, then
// the colored fills, then the pins on top.
export function routeDrawItems(route: RouteOverlay): RouteDrawItem[] {
  const items: RouteDrawItem[] = []
  for (const s of route.segments) {
    items.push({ ax: s.ax, ay: s.ay, bx: s.bx, by: s.by, r: s.r + ROUTE_CASING_EXTRA_WORLD, color: ROUTE_WHITE })
  }
  for (const s of route.segments) {
    items.push({ ax: s.ax, ay: s.ay, bx: s.bx, by: s.by, r: s.r, color: s.color })
  }
  // Intermediate stops first, so an end pin landing on the same spot covers its
  // dot rather than being punctured by it.
  for (const pin of route.pins) {
    if (pin.kind !== 'stop') continue
    const disc = (r: number, color: [number, number, number]) => {
      items.push({ ax: pin.x, ay: pin.y, bx: pin.x, by: pin.y, r, color })
    }
    const radius = pin.r ?? ROUTE_STOP_RADIUS_WORLD
    disc(radius + ROUTE_CASING_EXTRA_WORLD, ROUTE_WHITE)
    disc(radius, pin.color ?? ROUTE_INK)
    disc(radius * ROUTE_STOP_INNER_RATIO, ROUTE_WHITE)
  }
  for (const pin of route.pins) {
    if (pin.kind === 'stop') continue
    const disc = (r: number, color: [number, number, number]) => {
      items.push({ ax: pin.x, ay: pin.y, bx: pin.x, by: pin.y, r, color })
    }
    disc(ROUTE_PIN_RADIUS_WORLD + ROUTE_CASING_EXTRA_WORLD, ROUTE_WHITE)
    disc(ROUTE_PIN_RADIUS_WORLD, pin.color ?? ROUTE_INK)
    disc(ROUTE_PIN_INNER_WORLD, ROUTE_WHITE)
    pushArrow(items, pin.x, pin.y, pin.kind === 'origin' ? 'up' : 'down', pin.color ?? ROUTE_INK)
  }
  return items
}

/*
 * An arrow glyph as three capsules: a vertical shaft plus two chevron strokes.
 *
 * Capsules rather than a path because RouteDrawItem is the only vocabulary both
 * renderers share — giving them a triangle or an SVG path would mean two new
 * code paths that could drift. Rounded caps are what make the joint at the tip
 * read as a point instead of a notch.
 *
 * Screen y grows downward, so 'up' puts the tip at -halfH.
 */
function pushArrow(
  items: RouteDrawItem[],
  cx: number,
  cy: number,
  direction: 'up' | 'down',
  color: [number, number, number]
): void {
  // +1 draws the glyph pointing down, -1 flips it to point up.
  const sign = direction === 'up' ? -1 : 1
  const tipY = cy + sign * ROUTE_ARROW_HALF_H
  const tailY = cy - sign * ROUTE_ARROW_HALF_H
  const stroke = (ax: number, ay: number, bx: number, by: number) => {
    items.push({ ax, ay, bx, by, r: ROUTE_ARROW_HALF_WIDTH_WORLD, color })
  }
  stroke(cx, tailY, cx, tipY)
  // Barbs land short of the tip by the stroke's own half-width, so the three
  // rounded caps overlap into one point rather than fanning past it.
  const barbY = tipY - sign * ROUTE_ARROW_HALF_W
  stroke(cx - ROUTE_ARROW_HALF_W, barbY, cx, tipY)
  stroke(cx + ROUTE_ARROW_HALF_W, barbY, cx, tipY)
}

// Split a→b into dash sub-segments. The pattern is centered — equal margins at
// both ends — and a segment shorter than one dash yields itself whole, so very
// close stations still get a visible connector.
export function dashSegment(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  dashLen: number,
  gapLen: number
): Array<{ ax: number, ay: number, bx: number, by: number }> {
  const len = Math.hypot(bx - ax, by - ay)
  if (len <= 0) return []
  const dirX = (bx - ax) / len
  const dirY = (by - ay) / len
  const count = Math.max(1, Math.floor((len + gapLen) / (dashLen + gapLen)))
  const patternLen = count * dashLen + (count - 1) * gapLen
  const margin = (len - patternLen) / 2
  const dashes: Array<{ ax: number, ay: number, bx: number, by: number }> = []
  for (let i = 0; i < count; i++) {
    const start = Math.max(0, margin + i * (dashLen + gapLen))
    const end = Math.min(len, start + dashLen)
    dashes.push({
      ax: ax + dirX * start,
      ay: ay + dirY * start,
      bx: ax + dirX * end,
      by: ay + dirY * end
    })
  }
  return dashes
}

export interface TileStats {
  count: number
  bytes: number
  // Tile loads queued but not yet started, and decoded bitmaps waiting for an
  // upload slot. These are what MAX_CONCURRENT_TILE_LOADS and
  // MAX_UPLOADS_PER_FRAME are tuned against: a queue that stays deep through a
  // pinch means the pacing is too tight for the device, one that never fills
  // means it isn't binding. Absent on the 2D renderer, which has no queue.
  queued?: number
  ready?: number
  // Cumulative wall time spent in texImage2D + generateMipmap, in ms. The one
  // main-thread cost the pacing exists to spread out, and the number that
  // settles whether RGB565's halved residency is worth its upload conversion.
  uploadMs?: number
}

// Escape hatch for forcing context loss on demand. Only the WebGL renderer has
// one, and only when the browser exposes WEBGL_lose_context — context loss
// otherwise takes half an hour of real memory pressure to reproduce.
export interface RendererDebug {
  loseContext(): void
  restoreContext(): void
}

export interface Renderer {
  kind: 'webgl2' | 'canvas2d'
  draw(transform: Transform, cssW: number, cssH: number, dpr: number, currentTier: Tier, selection?: SelectionOverlay | null, route?: RouteOverlayFrame | null): void
  resize(cssW: number, cssH: number, dpr: number): void
  requestTier(r: number, c: number, tier: Tier): void
  setPoints(points: Point[]): void
  setRouteOverlay(route: RouteOverlay | null): void
  setDebugHitboxes(enabled: boolean): void
  // True once the GPU has taken the drawing context away. Every GL call after
  // that point is a silent no-op, so callers must stop drawing and rebuild the
  // renderer rather than carry on against a dead context.
  isContextLost(): boolean
  // Drop every tile's pixels while keeping the renderer usable. Tiles re-request
  // themselves on the next draw and the preview underlay covers the gap.
  releaseTiles(): void
  // True once the preview underlay can be drawn — the earliest frame that
  // contains the map rather than a blank canvas. The card→map morph overlay
  // (components/map-morph.tsx) holds until then. Optional so test doubles and
  // future renderers don't have to care.
  isPreviewReady?(): boolean
  tileStats(): TileStats
  debug?: RendererDebug
  dispose(): void
}

// Signed distance from (px, py) to the boundary of a point's rounded-rect
// shape — negative inside. Standard rounded-box SDF evaluated in the shape's
// local frame (x along the a→b axis, y across it).
export function pointToShapeDistance(px: number, py: number, p: Point): number {
  const abx = p.bx - p.ax
  const aby = p.by - p.ay
  const len = Math.hypot(abx, aby)
  const dirX = len > 0 ? abx / len : 1
  const dirY = len > 0 ? aby / len : 0
  const relX = px - (p.ax + p.bx) / 2
  const relY = py - (p.ay + p.by) / 2
  const cr = pointCornerRadius(p)
  // Local coords, folded into the first quadrant; box shrunk by cr.
  const qx = Math.abs(relX * dirX + relY * dirY) - (len / 2 + p.r - cr)
  const qy = Math.abs(relX * -dirY + relY * dirX) - (p.r - cr)
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - cr
}

// Kind-agnostic nearest-shape hit-test: returns the closest hit point
// regardless of whether it's a station or a hub. Used by author mode, where
// every point (including hub regions) must be selectable for editing.
export function hitTestPoints(
  worldX: number,
  worldY: number,
  points: Point[],
  slopWorld: number
): Point | null {
  let best: Point | null = null
  let bestDist = Infinity
  for (const p of points) {
    const effective = pointToShapeDistance(worldX, worldY, p) - slopWorld
    if (effective <= 0 && effective < bestDist) {
      bestDist = effective
      best = p
    }
  }
  return best
}

// Hub tap targets are authored as points whose id starts with `HUB-` (mirroring
// hubs.id, e.g. `HUB-DKA`). Station points use `OPERATOR-CODE`.
// Deliberately tests `id`, not `pointStationId`: what a point *is* (hub region
// vs station pill) is a property of the shape, not of the station it opens.
export function isHubPoint(p: Point): boolean {
  return p.id.startsWith('HUB-')
}

// Label tap targets are authored as points whose id is `LBL-` + the id of the
// point they name, so the drawn station NAME is tappable as well as its marker.
// Tested on `id` for the same reason as isHubPoint: this is what the shape IS,
// not which station it opens — `station` carries that, exactly as for a halte
// drawn twice.
export function isLabelPoint(p: Point): boolean {
  return p.id.startsWith('LBL-')
}

export type HitResult =
  | { kind: 'station', point: Point }
  | { kind: 'hub', point: Point }
  | { kind: 'label', point: Point }

/*
 * Runtime tap hit-test, resolved in tiers: station, then hub, then label. A
 * closer shape in a lower tier never wins.
 *
 * Station over hub: a hub region and its member pills overlap, so a tap on a
 * member pill must open that station, while a tap in the gap between members
 * (inside the authored hub region, outside every pill) opens the hub.
 *
 * Both over label: a label is much the largest shape on the map — a name is
 * ~13x the area of its dot — and it routinely covers markers and hub regions
 * belonging to OTHER stations. Ranking by distance alone would let a name
 * swallow the very pills drawn on top of it, so the precise target wins
 * wherever the two overlap and the name is what catches everything else.
 */
export function hitTest(
  worldX: number,
  worldY: number,
  points: Point[],
  slopWorld: number
): HitResult | null {
  let bestStation: Point | null = null
  let bestStationDist = Infinity
  let bestHub: Point | null = null
  let bestHubDist = Infinity
  let bestLabel: Point | null = null
  let bestLabelDist = Infinity
  for (const p of points) {
    const effective = pointToShapeDistance(worldX, worldY, p) - slopWorld
    if (effective > 0) continue
    if (isLabelPoint(p)) {
      if (effective < bestLabelDist) {
        bestLabelDist = effective
        bestLabel = p
      }
    } else if (isHubPoint(p)) {
      if (effective < bestHubDist) {
        bestHubDist = effective
        bestHub = p
      }
    } else if (effective < bestStationDist) {
      bestStationDist = effective
      bestStation = p
    }
  }
  if (bestStation) return { kind: 'station', point: bestStation }
  if (bestHub) return { kind: 'hub', point: bestHub }
  if (bestLabel) return { kind: 'label', point: bestLabel }
  return null
}

export interface CreateRendererOptions {
  // Context-loss recovery passes false. A device that just had its GPU context
  // taken away must not be handed the 2D renderer, which keeps the same tiles
  // as ImageBitmaps and would trade a GPU-memory problem for a CPU-memory one.
  allowCanvas2DFallback?: boolean
  // Absolute cap on resident tile bytes for this device. The per-frame budget
  // is derived from the visible working set and clamped to this; see
  // tileBudgetBytes and the PHONE/DESKTOP ceilings below.
  tileBudgetCeilingBytes?: number
}

export function createRenderer(
  canvas: HTMLCanvasElement,
  manifest: Manifest,
  baseUrl: string,
  onDirty: () => void,
  opts: CreateRendererOptions = {}
): Renderer {
  try {
    return createWebGLRenderer(canvas, manifest, baseUrl, onDirty, opts.tileBudgetCeilingBytes)
  } catch (e) {
    if (opts.allowCanvas2DFallback === false) throw e
    console.warn('WebGL2 unavailable, falling back to 2D canvas', e)
    return createCanvas2DRenderer(canvas, manifest, baseUrl, onDirty)
  }
}

// Ceiling on the device pixel ratio the map is rendered at.
//
// A 3x phone draws 2.25x the fragments of a 2x one for detail that the artwork
// — flat fills and text, already antialiased into the tiles — does not carry.
// The clamp also feeds pickTier, whose target is scale * dpr: at dpr 2 the band
// scale 0.333-0.5 resolves to tier 1 instead of tier 2, which is a 4x drop in
// per-tile memory (10.7 MB -> 2.67 MB) across a slice of the zoom range the map
// actually sits in.
//
// Callers must clamp consistently: resize() sets the canvas backing size while
// draw() computes gl.viewport() independently, and the two have to agree.
export const MAX_RENDER_DPR = 2

export function renderDpr(raw: number | undefined): number {
  const dpr = typeof raw === 'number' && raw > 0 && Number.isFinite(raw) ? raw : 1
  return Math.min(MAX_RENDER_DPR, dpr)
}

export function pickTier(scale: number, dpr: number, currentTier: Tier, maxTier: Tier = MAX_TIER): Tier {
  const target = scale * dpr
  const cap = Math.min(MAX_TIER, maxTier)
  // Round the required texel:pixel ratio up to a power of two, then clamp into
  // [MIN_TIER, cap]. Flooring at MIN_TIER rather than 1 admits the half-res
  // tier: below the preview handoff `target` runs ~0.14-0.45, which a full-size
  // texture would serve minified up to 7x.
  const raw = Math.min(cap, Math.max(MIN_TIER, 2 ** Math.ceil(Math.log2(Math.max(target, MIN_TIER)))))
  // Hysteresis: don't upgrade until comfortably past the boundary, so a pinch
  // that hovers on the threshold doesn't thrash between tiers.
  if (raw > currentTier && target <= currentTier * 1.1) return currentTier
  return raw as Tier
}

export function tileKey(r: number, c: number): string {
  return `${r}-${c}`
}

// How much pan-back history to keep beyond what is currently on screen. One
// extra screen: enough that reversing a pan is instant, far short of caching
// the whole grid (which at tier 2 on an 8x8 map is ~683 MB and is what got a
// context killed).
const BUDGET_HEADROOM = 2

export interface TileBudgetArgs {
  // Tiles in the current frame's visible span.
  visibleTiles: number
  // GPU bytes one tile costs at the current tier, mipmaps included.
  tileBytes: number
  // Absolute cap for this device, from the caller's device policy.
  ceilingBytes: number
  // navigator.deviceMemory, in GB, where the browser reports it.
  deviceMemoryGb?: number
}

// Resident-tile budget for the current frame.
//
// Derive it from the visible set, never a flat constant. Eviction refuses to
// drop on-screen tiles, so a budget below the working set is not a tighter
// policy — it is a sweep that runs, finds nothing droppable and overshoots
// silently. The floor keeps the number agreeing with that invariant.
export function tileBudgetBytes(args: TileBudgetArgs): number {
  const workingSet = Math.max(0, args.visibleTiles) * Math.max(0, args.tileBytes)
  let ceiling = args.ceilingBytes
  // deviceMemory may only tighten. It is a weak signal — absent on iOS, capped
  // at 8, quantised to a handful of values — so letting it *raise* the ceiling
  // would be inventing headroom from a number that cannot support it.
  if ((args.deviceMemoryGb ?? Infinity) <= 4) {
    ceiling = Math.min(ceiling, LOW_MEMORY_CEILING_BYTES)
  }
  return Math.max(workingSet, Math.min(ceiling, workingSet * BUDGET_HEADROOM))
}

const MB = 1024 * 1024

// Device ceilings, chosen against what each class can actually have on screen.
//
// A phone caps at tier 2, where the post-DPR-clamp worst case is ~6 visible
// tiles at 10.7 MB — ~64 MB — so 128 MB is one to two screens of history.
//
// Desktop reaches tier 4, which is not pre-rasterized: those tiles come from
// the runtime SVG path, keep their transparent background and so upload as
// RGBA at ~85 MB each. Four of them visible is ~341 MB, which the old flat
// 192 MB silently overshot rather than enforced.
export const PHONE_TILE_BUDGET_CEILING_BYTES = 128 * MB
export const DESKTOP_TILE_BUDGET_CEILING_BYTES = 640 * MB
export const LOW_MEMORY_CEILING_BYTES = 128 * MB
