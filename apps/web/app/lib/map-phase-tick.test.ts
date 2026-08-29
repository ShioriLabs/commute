import { describe, expect, it } from 'vitest'
import { phaseStep, easeOut } from './map-phase-tick'

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
