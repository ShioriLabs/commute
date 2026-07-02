import { createWebGLRenderer } from './map-renderer-webgl'
import { createCanvas2DRenderer } from './map-renderer-canvas2d'

export interface Manifest {
  version: string
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

export type Tier = 1 | 2 | 4

export const TIERS: Tier[] = [1, 2, 4]
export const MAX_TIER: Tier = 4

export interface Point {
  id: string
  ax: number
  ay: number
  bx: number
  by: number
  r: number
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

export interface Renderer {
  kind: 'webgl2' | 'canvas2d'
  draw(transform: Transform, cssW: number, cssH: number, dpr: number, currentTier: Tier, selection?: SelectionOverlay | null): void
  resize(cssW: number, cssH: number, dpr: number): void
  requestTier(r: number, c: number, tier: Tier): void
  setPoints(points: Point[]): void
  setDebugHitboxes(enabled: boolean): void
  dispose(): void
}

export function pointToCapsuleDistance(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number
): number {
  const abx = bx - ax
  const aby = by - ay
  const apx = px - ax
  const apy = py - ay
  const lenSq = abx * abx + aby * aby
  let t = lenSq > 0 ? (apx * abx + apy * aby) / lenSq : 0
  t = Math.max(0, Math.min(1, t))
  const cx = ax + abx * t
  const cy = ay + aby * t
  const dx = px - cx
  const dy = py - cy
  return Math.sqrt(dx * dx + dy * dy)
}

// Kind-agnostic nearest-capsule hit-test: returns the closest hit point
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
    const d = pointToCapsuleDistance(worldX, worldY, p.ax, p.ay, p.bx, p.by)
    const effective = d - (p.r + slopWorld)
    if (effective <= 0 && effective < bestDist) {
      bestDist = effective
      best = p
    }
  }
  return best
}

// Hub tap targets are authored as points whose id starts with `HUB-` (mirroring
// hubs.id, e.g. `HUB-DKA`). Station points use `OPERATOR-CODE`.
export function isHubPoint(p: Point): boolean {
  return p.id.startsWith('HUB-')
}

export type HitResult =
  | { kind: 'station', point: Point }
  | { kind: 'hub', point: Point }

// Runtime tap hit-test. A hub region and its member pills overlap; a tap on a
// member pill must open that station, while a tap in the gap between members
// (inside the authored hub region, outside every pill) opens the hub. So a
// station hit ALWAYS beats a hub hit, even a geometrically closer one.
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
  for (const p of points) {
    const d = pointToCapsuleDistance(worldX, worldY, p.ax, p.ay, p.bx, p.by)
    const effective = d - (p.r + slopWorld)
    if (effective > 0) continue
    if (isHubPoint(p)) {
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
  return null
}

export function createRenderer(
  canvas: HTMLCanvasElement,
  manifest: Manifest,
  baseUrl: string,
  onDirty: () => void
): Renderer {
  try {
    return createWebGLRenderer(canvas, manifest, baseUrl, onDirty)
  } catch (e) {
    console.warn('WebGL2 unavailable, falling back to 2D canvas', e)
    return createCanvas2DRenderer(canvas, manifest, baseUrl, onDirty)
  }
}

export function pickTier(scale: number, dpr: number, currentTier: Tier, maxTier: Tier = MAX_TIER): Tier {
  const target = scale * dpr
  const cap = Math.min(MAX_TIER, maxTier)
  const raw = Math.min(cap, Math.max(1, 2 ** Math.ceil(Math.log2(Math.max(target, 1)))))
  if (raw > currentTier && target <= currentTier * 1.1) return currentTier
  return raw as Tier
}

export function tileKey(r: number, c: number): string {
  return `${r}-${c}`
}
