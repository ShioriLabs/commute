// The camera the map's first frame is drawn with, transcribed from
// routes/map.tsx's initial-centering effect so the morph overlay
// (components/map-morph.tsx) can show preview.webp in exactly the position the
// canvas will paint it — the overlay fade-out is only invisible if the two
// frames line up.
//
// Pure and in utils/ because apps/web has no jsdom test environment (see the
// header of utils/morph.ts): this math is the only part of the handoff a test
// can cover, and the test cross-checks the constants below against the real
// manifest.json / points.json so they cannot drift silently.

export interface PreviewCamera {
  tx: number
  ty: number
  scale: number
}

// public/maps/fdtj/manifest.json: viewBox [2]/[3] and preview w/h. Hardcoded
// rather than imported: map.tsx deliberately imports points.json as ?url to
// keep it out of the bundle, and the manifest only exists at runtime.
export const FDTJ_MAP_W = 9513.57
export const FDTJ_MAP_H = 6726.88
export const FDTJ_PREVIEW_W = 1280
export const FDTJ_PREVIEW_H = 905

// Midpoint of the KCI-MRI (Manggarai) tap target in app/data/points.json —
// the anchor map.tsx centers under the viewport on first load.
export const FDTJ_ANCHOR_X = (4896.767099009742 + 4838.633581190369) / 2
export const FDTJ_ANCHOR_Y = (3834.6362339024877 + 3891.7030770038155) / 2

// map.tsx's initial camera: cover-fit scale floored at 0.5 (on any real screen
// fitScale < 0.5, so this is 0.5), the anchor placed under the viewport
// center, then the same per-axis rule as its clampTransform — center an axis
// whose scaled map is smaller than the viewport, otherwise clamp so the map
// edge stays outside. MAX_SCALE never binds: max(fitScale, 0.5) can only
// exceed it on viewports larger than half the map, where fitScale itself is
// the floor.
export function previewCamera(viewportW: number, viewportH: number): PreviewCamera {
  const w = Math.max(1, viewportW)
  const h = Math.max(1, viewportH)

  const fitScale = Math.max(w / FDTJ_MAP_W, h / FDTJ_MAP_H)
  const scale = Math.max(fitScale, 0.5)

  const rawTx = w / 2 - FDTJ_ANCHOR_X * scale
  const rawTy = h / 2 - FDTJ_ANCHOR_Y * scale

  const scaledW = FDTJ_MAP_W * scale
  const scaledH = FDTJ_MAP_H * scale
  const tx = scaledW <= w
    ? (w - scaledW) / 2
    : Math.min(0, Math.max(w - scaledW, rawTx))
  const ty = scaledH <= h
    ? (h - scaledH) / 2
    : Math.min(0, Math.max(h - scaledH, rawTy))

  return { tx, ty, scale }
}
