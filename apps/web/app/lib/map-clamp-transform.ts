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
 *
 * The same holds for the phone's sheet band and the height term, and more
 * sharply: on a portrait phone it is the HEIGHT that binds, by roughly 3x, so
 * subtracting the sheet would lower the floor and let the map shrink narrower
 * than the screen — white bars down both sides, which is a worse failure than
 * the stranding it would be trying to fix. Same answer, same reason, other axis.
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
 * Both insets buy pan slack under chrome, and both do it the same way: relax
 * the bound on the side the chrome is on and leave the opposite bound alone.
 * Which bound that is differs per axis, and the asymmetry is why the two pairs
 * of lines below do not look like each other.
 *
 * `insetL` is the desktop pane, a band on the LOW end of x. Screen x is
 * `worldX * scale + tx`, so uncovering what is beneath it means moving the map
 * RIGHT — tx grows — so it is the UPPER bound that shifts, from 0 up to the
 * pane's inner edge. That is what makes the western terminals (Tangerang,
 * Rangkasbitung) reachable at all: at minimum zoom the scaled map exactly fills
 * the viewport, so without this there is no pan slack and they are not merely
 * covered but unreachable.
 *
 * `insetB` is the phone's bottom sheet, a band on the HIGH end of y. The map
 * has to move UP to uncover it, so ty goes more negative and it is the LOWER
 * bound that shifts, down to `viewportH - insetB - scaledH`. Exactly the same
 * problem: on a portrait phone the height binds, so at minimum zoom there is
 * not one pixel of vertical slack and roughly a third of the network sits under
 * the sheet with no gesture able to bring it out.
 *
 * The other two bounds are deliberately untouched. Nothing covers the right
 * edge or the top edge in either layout, so both must still come flush to the
 * real viewport edge; pulling them in would invent a band that is not there.
 */
export function clampTransform(
  t: Transform,
  viewportW: number,
  viewportH: number,
  mapW: number,
  mapH: number,
  minScale: number,
  insetL = 0,
  insetB = 0
): Transform {
  const scale = Math.max(minScale, Math.min(MAX_SCALE, t.scale))
  const scaledW = mapW * scale
  const scaledH = mapH * scale
  // Never let a band claim more than the viewport actually has: a narrow
  // desktop window, or a sheet taller than the viewport, would otherwise
  // invert the range and strand the camera.
  const bandL = Math.max(0, Math.min(insetL, viewportW))
  const bandB = Math.max(0, Math.min(insetB, viewportH))
  const usableW = viewportW - bandL
  const usableH = viewportH - bandB
  /*
   * If the map is smaller than the usable area on an axis, center it there;
   * otherwise clamp so the map edge can't be dragged inside that area.
   *
   * The two centring branches are asymmetric, and it is the easiest line here
   * to "fix" back into a bug: the visible strip on x STARTS at the pane's inner
   * edge, so a too-small map centres at `bandL + half the slack`. The strip on
   * y starts at the top of the viewport and merely ENDS early at the sheet, so
   * the same map centres with no leading term. Adding one for symmetry would
   * push the map down behind the sheet.
   */
  const tx = scaledW <= usableW
    ? bandL + (usableW - scaledW) / 2
    : Math.min(bandL, Math.max(viewportW - scaledW, t.tx))
  const ty = scaledH <= usableH
    ? (usableH - scaledH) / 2
    : Math.min(0, Math.max(usableH - scaledH, t.ty))
  return { tx, ty, scale }
}
