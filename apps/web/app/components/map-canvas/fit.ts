import type { Point, Transform } from '../../lib/map-renderer'

// Upper zoom bound. The schematic is a fixed-resolution raster, so past this
// the tiles just get blurry — there's no more detail to reveal.
export const MAX_SCALE = 1.5

// Padding around a fitted bounding box, as a fraction of the visible area.
// Keeps fitted points off the very edge of the screen.
const FIT_PADDING_FRACTION = 0.12

export interface Bounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

/**
 * Smallest scale that still fills the viewport's shorter dimension. Uses max()
 * rather than min() so the map's short side fills the screen: the long side
 * overflows and is pannable, but no letterbox bars appear.
 */
export function minScaleFor(viewportW: number, viewportH: number, mapW: number, mapH: number): number {
  if (!viewportW || !viewportH || !mapW || !mapH) return 0.01
  return Math.max(viewportW / mapW, viewportH / mapH)
}

/**
 * Clamp scale into [minScale, MAX_SCALE] and keep the map's edges outside the
 * viewport. When the map is smaller than the viewport on an axis it is centred
 * on that axis instead.
 */
export function clampTransform(
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
  const tx = scaledW <= viewportW
    ? (viewportW - scaledW) / 2
    : Math.min(0, Math.max(viewportW - scaledW, t.tx))
  const ty = scaledH <= viewportH
    ? (viewportH - scaledH) / 2
    : Math.min(0, Math.max(viewportH - scaledH, t.ty))
  return { tx, ty, scale }
}

/**
 * Place a world point under the centre of the *visible* area. `bottomInset` is
 * the height of anything covering the bottom of the viewport (a peeked sheet),
 * so the target lands in the gap above it rather than behind it.
 */
export function centerOn(
  worldX: number,
  worldY: number,
  scale: number,
  viewportW: number,
  viewportH: number,
  bottomInset = 0
): Transform {
  return {
    tx: viewportW / 2 - worldX * scale,
    ty: (viewportH - bottomInset) / 2 - worldY * scale,
    scale
  }
}

/** Axis-aligned bounds of a point's drawn shape, including its half-width. */
export function boundsOfPoint(p: Point): Bounds {
  return {
    minX: Math.min(p.ax, p.bx) - p.r,
    minY: Math.min(p.ay, p.by) - p.r,
    maxX: Math.max(p.ax, p.bx) + p.r,
    maxY: Math.max(p.ay, p.by) + p.r
  }
}

/** Union bounds of several points, or null when the list is empty. */
export function boundsOf(points: Point[]): Bounds | null {
  if (points.length === 0) return null
  return points.reduce<Bounds>((acc, p) => {
    const b = boundsOfPoint(p)
    return {
      minX: Math.min(acc.minX, b.minX),
      minY: Math.min(acc.minY, b.minY),
      maxX: Math.max(acc.maxX, b.maxX),
      maxY: Math.max(acc.maxY, b.maxY)
    }
  }, boundsOfPoint(points[0]))
}

/**
 * Transform that frames `points` inside the area above `bottomInset`.
 *
 * Returns null for an empty list so callers can fall back to an anchor.
 *
 * Fit only ever zooms *out* from `preferredScale`, never in. A lone saved
 * station is still a ~40-unit box once its radius is counted, and two adjacent
 * stations are barely bigger — fitting those literally would slam the camera to
 * MAX_SCALE. Zooming out to bring things into view is the only job here.
 *
 * The result can still be wider than the viewport: `minScale` keeps the map's
 * short axis filled (no letterboxing), so stations far enough apart cannot all
 * be shown at once. They end up centred at minimum zoom instead.
 */
export function fitTransform(
  points: Point[],
  viewportW: number,
  viewportH: number,
  mapW: number,
  mapH: number,
  bottomInset: number,
  preferredScale: number
): Transform | null {
  const bounds = boundsOf(points)
  if (!bounds || !viewportW || !viewportH) return null

  const minScale = minScaleFor(viewportW, viewportH, mapW, mapH)
  const visibleH = Math.max(1, viewportH - bottomInset)
  const centerX = (bounds.minX + bounds.maxX) / 2
  const centerY = (bounds.minY + bounds.maxY) / 2

  const boxW = Math.max(1, bounds.maxX - bounds.minX)
  const boxH = Math.max(1, bounds.maxY - bounds.minY)
  const padX = viewportW * FIT_PADDING_FRACTION
  const padY = visibleH * FIT_PADDING_FRACTION
  const availableW = Math.max(1, viewportW - padX * 2)
  const availableH = Math.max(1, visibleH - padY * 2)
  const fitScale = Math.min(availableW / boxW, availableH / boxH)

  return clampTransform(
    centerOn(centerX, centerY, Math.min(preferredScale, fitScale), viewportW, viewportH, bottomInset),
    viewportW, viewportH, mapW, mapH, minScale
  )
}
