import { describe, expect, it } from 'vitest'
import { phaseStep, easeOut, clamp01 } from './map-phase-tick'

const IN = 350

describe('phaseStep', () => {
  it('draws the frame that completes an entrance', () => {
    // The regression this module exists for: the settling frame seats the final
    // value, and the loop parks the moment the phase reads `hold`. Skipping its
    // draw left the previous frame on screen — a switched-away line lingering
    // until the rider touched the map.
    const step = phaseStep('in', IN, IN)
    expect(step.progress).toBe(1)
    expect(step.phase).toBe('hold')
    expect(step.dirty).toBe(true)
  })

  it('draws every frame while easing in', () => {
    for (const t of [0, 50, 175, 349]) {
      expect(phaseStep('in', t, IN).dirty).toBe(true)
    }
  })

  it('lets the loop park once a phase is holding', () => {
    const step = phaseStep('hold', 10_000, IN)
    expect(step.dirty).toBe(false)
    expect(step.progress).toBe(1)
  })

  it('reports an exit as done only on its final frame', () => {
    expect(phaseStep('out', 100, 220).done).toBe(false)
    expect(phaseStep('out', 220, 220).done).toBe(true)
    expect(phaseStep('out', 220, 220).progress).toBe(0)
  })

  it('keeps drawing through an exit', () => {
    for (const t of [0, 110, 220]) {
      expect(phaseStep('out', t, 220).dirty).toBe(true)
    }
  })

  it('eases out cubically, anchored at both ends', () => {
    expect(easeOut(0)).toBe(0)
    expect(easeOut(1)).toBe(1)
    // Front-loaded: half the time is well past half the distance.
    expect(easeOut(0.5)).toBeGreaterThan(0.8)
  })

  it('treats a zero duration as instantly complete', () => {
    const step = phaseStep('in', 0, 0)
    expect(step.progress).toBe(1)
    expect(step.phase).toBe('hold')
    expect(step.dirty).toBe(true)
  })
})

/*
 * The rAF timestamp marks the START of a frame, so it can predate a phaseStart
 * sampled from performance.now() inside the handler that began the ramp. That
 * really happens: clearing a fare route measured p = -0.035 on the first exit
 * frame, and easeOut ran the curve backwards to 1.108 — the fade overshot full
 * strength before it began to fall.
 */
describe('clamp01', () => {
  it('holds a phase at its origin when the frame predates its start', () => {
    expect(clamp01(-0.035)).toBe(0)
    expect(easeOut(clamp01(-0.035))).toBe(0)
  })

  it('never lets easeOut exceed full strength', () => {
    for (const p of [-1, -0.035, 0, 0.5, 1, 1.5]) {
      const eased = easeOut(clamp01(p))
      expect(eased).toBeGreaterThanOrEqual(0)
      expect(eased).toBeLessThanOrEqual(1)
    }
  })

  it('leaves ordinary progress alone', () => {
    expect(clamp01(0.25)).toBe(0.25)
  })
})
