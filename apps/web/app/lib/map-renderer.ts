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

export interface Renderer {
  kind: 'webgl2' | 'canvas2d'
  draw(transform: Transform, cssW: number, cssH: number, dpr: number, currentTier: Tier): void
  resize(cssW: number, cssH: number, dpr: number): void
  requestTier(r: number, c: number, tier: Tier): void
  dispose(): void
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
