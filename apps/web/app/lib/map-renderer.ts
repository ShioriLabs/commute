import { createWebGLRenderer } from './map-renderer-webgl'
import { createCanvas2DRenderer } from './map-renderer-canvas2d'

export interface Manifest {
  version: string
  source: string
  viewBox: [number, number, number, number]
  grid: { rows: number, cols: number }
  tileSize: { w: number, h: number }
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

export interface Renderer {
  kind: 'webgl2' | 'canvas2d'
  draw(transform: Transform, cssW: number, cssH: number, dpr: number, currentTier: Tier): void
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

export function pickTier(scale: number, dpr: number, currentTier: Tier): Tier {
  const target = scale * dpr
  const raw = Math.min(MAX_TIER, Math.max(1, 2 ** Math.ceil(Math.log2(Math.max(target, 1)))))
  if (raw > currentTier && target <= currentTier * 1.1) return currentTier
  return raw as Tier
}

export function tileKey(r: number, c: number): string {
  return `${r}-${c}`
}
