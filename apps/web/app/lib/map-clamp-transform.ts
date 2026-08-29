// The single gate every camera write on the map passes through: drag, inertia,
// pinch, double-tap, fly-to and the route fit-bounds flight all end here.
//
// Extracted from routes/map.tsx for the same reason map-surface-inset.ts was:
// the rAF tick reads refs and never React state, and the suite is node-only
// with no DOM, so the only way this math gets tested is as a pure function.

import type { Transform } from './map-renderer'

export const MAX_SCALE = 1.5

/*
 * Minimum zoom: cover-fit, so the map's shorter dimension fills the viewport
 * and no letterbox bars appear. The longer one overflows and stays pannable.
 *
 * Deliberately NOT inset-aware, though threading the pane band through the
 * width term looks like the obvious way to buy pan slack at minimum zoom. It
 * backfires: max() takes whichever axis binds, and on a typical desktop window
 * that is the width, so subtracting the band would LOWER the floor and let the
 * artwork shrink away from the viewport edges it is supposed to cover. The
 * slack the pane needs comes from clampTransform's shifted upper bound instead.
 */
export function minScaleFor(
  viewportW: number,
  viewportH: number,
  mapW: number,
  mapH: number
): number {
  if (!viewportW || !viewportH || !mapW || !mapH) return 0.01
  return Math.max(viewportW / mapW, viewportH / mapH)
}

/*
 * Clamp a requested camera into the legal range.
 *
 * `insetL` shifts only the x axis, and only its upper bound: the map's left
 * edge may travel as far right as the pane's inner edge, so anything hidden
 * beneath the pane can be brought into the strip beside it. The lower bound is
 * deliberately left at `viewportW - scaledW` — nothing covers the right edge,
 * so it should still come flush to the real viewport edge. The y axis is
 * untouched because the pane spans the full height and never covers the bottom.
 */
export function clampTransform(
  t: Transform,
  viewportW: number,
  viewportH: number,
  mapW: number,
  mapH: number,
  minScale: number,
  insetL = 0
): Transform {
  const scale = Math.max(minScale, Math.min(MAX_SCALE, t.scale))
  const scaledW = mapW * scale
  const scaledH = mapH * scale
  // Never let the band claim more than the viewport actually has: a narrow
  // desktop window would otherwise invert the range and strand the camera.
  const inset = Math.max(0, Math.min(insetL, viewportW))
  const usableW = viewportW - inset
  // If the map is smaller than the usable area on an axis, center it there;
  // otherwise clamp so the map edge can't be dragged inside that area.
  const tx = scaledW <= usableW
    ? inset + (usableW - scaledW) / 2
    : Math.min(inset, Math.max(viewportW - scaledW, t.tx))
  const ty = scaledH <= viewportH
    ? (viewportH - scaledH) / 2
    : Math.min(0, Math.max(viewportH - scaledH, t.ty))
  return { tx, ty, scale }
}
