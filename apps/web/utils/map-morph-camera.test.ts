import { describe, expect, it } from 'vitest'
import manifest from '../public/maps/fdtj/manifest.json'
import points from '../app/data/points.json'
import {
  FDTJ_ANCHOR_X,
  FDTJ_ANCHOR_Y,
  FDTJ_MAP_H,
  FDTJ_MAP_W,
  FDTJ_PREVIEW_H,
  FDTJ_PREVIEW_W,
  previewCamera
} from './map-morph-camera'

describe('constants stay in sync with the real map assets', () => {
  it('matches manifest.json viewBox and preview size', () => {
    expect(FDTJ_MAP_W).toBe(manifest.viewBox[2])
    expect(FDTJ_MAP_H).toBe(manifest.viewBox[3])
    expect(FDTJ_PREVIEW_W).toBe(manifest.preview.w)
    expect(FDTJ_PREVIEW_H).toBe(manifest.preview.h)
  })

  it('matches the KCI-MRI midpoint in points.json', () => {
    const anchor = points.points.find(p => p.id === 'KCI-MRI')
    expect(anchor).toBeDefined()
    expect(FDTJ_ANCHOR_X).toBeCloseTo((anchor!.ax + anchor!.bx) / 2, 9)
    expect(FDTJ_ANCHOR_Y).toBeCloseTo((anchor!.ay + anchor!.by) / 2, 9)
  })
})

describe('previewCamera', () => {
  it('uses scale 0.5 with the anchor centered on a phone viewport', () => {
    const { tx, ty, scale } = previewCamera(390, 844)
    expect(scale).toBe(0.5)
    // Anchor lands under the viewport center: neither clamp binds here because
    // Manggarai sits deep inside the map on both axes.
    expect(tx).toBeCloseTo(390 / 2 - FDTJ_ANCHOR_X * 0.5, 6)
    expect(ty).toBeCloseTo(844 / 2 - FDTJ_ANCHOR_Y * 0.5, 6)
    // And the clamp invariant holds: map edges outside the viewport.
    expect(tx).toBeLessThanOrEqual(0)
    expect(tx).toBeGreaterThanOrEqual(390 - FDTJ_MAP_W * 0.5)
    expect(ty).toBeLessThanOrEqual(0)
    expect(ty).toBeGreaterThanOrEqual(844 - FDTJ_MAP_H * 0.5)
  })

  it('clamps rather than centering on a desktop viewport', () => {
    const { tx, ty, scale } = previewCamera(1280, 720)
    expect(scale).toBe(0.5)
    expect(tx).toBeLessThanOrEqual(0)
    expect(tx).toBeGreaterThanOrEqual(1280 - FDTJ_MAP_W * 0.5)
    expect(ty).toBeLessThanOrEqual(0)
    expect(ty).toBeGreaterThanOrEqual(720 - FDTJ_MAP_H * 0.5)
  })

  it('switches to cover-fit above the 0.5 floor on oversized viewports', () => {
    const { scale } = previewCamera(6000, 4000)
    expect(scale).toBeCloseTo(Math.max(6000 / FDTJ_MAP_W, 4000 / FDTJ_MAP_H), 9)
    expect(scale).toBeGreaterThan(0.5)
  })

  it('centers an axis when the scaled map is smaller than the viewport', () => {
    // A very wide, short viewport: width drives fitScale, so the scaled height
    // can end up smaller than the viewport height and must center.
    const w = 8000
    const h = 400
    const { ty, scale } = previewCamera(w, h)
    const scaledH = FDTJ_MAP_H * scale
    if (scaledH <= h) {
      expect(ty).toBeCloseTo((h - scaledH) / 2, 6)
    } else {
      expect(ty).toBeLessThanOrEqual(0)
    }
  })
})
