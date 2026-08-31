import { describe, expect, it } from 'vitest'
import { easeCameraFlight } from './map-easing'

describe('easeCameraFlight', () => {
  it('lands exactly on both endpoints', () => {
    // Not approximately: the flight ends when p >= 1, and the frame that ends
    // it seats the destination transform. A y of 0.9999997 would park the
    // camera a hair short of the point the rider tapped, permanently.
    expect(easeCameraFlight(0)).toBe(0)
    expect(easeCameraFlight(1)).toBe(1)
  })

  it('clamps progress outside 0..1', () => {
    expect(easeCameraFlight(-0.5)).toBe(0)
    expect(easeCameraFlight(1.5)).toBe(1)
  })

  it('never overshoots its destination', () => {
    // The curve is monotonic, so the camera cannot sail past a clamped
    // transform and snap back. If the control points are ever retuned into a
    // real overshoot, this fails — and the clamped destinations in map.tsx stop
    // being guaranteed in-bounds.
    for (let i = 0; i <= 1000; i++) {
      const y = easeCameraFlight(i / 1000)
      expect(y).toBeGreaterThanOrEqual(0)
      expect(y).toBeLessThanOrEqual(1)
    }
  })

  it('rises monotonically', () => {
    let prev = -1
    for (let i = 0; i <= 1000; i++) {
      const y = easeCameraFlight(i / 1000)
      expect(y).toBeGreaterThanOrEqual(prev)
      prev = y
    }
  })

  it('front-loads the travel', () => {
    // Half the reason for the curve. easeInOutCubic had spent 6% of the flight
    // by the quarter mark, which reads as the camera hesitating after a tap.
    expect(easeCameraFlight(0.25)).toBeGreaterThan(0.25)
    expect(easeCameraFlight(0.5)).toBeGreaterThan(0.75)
  })

  it('ramps in instead of lurching', () => {
    // The other half, and the regression that matters most: --ease-ios-spring
    // was tried here and hit 3.6x average speed a fifth of the way in, which
    // read as the camera snapping rather than flying. Cap the peak so a future
    // retune toward a punchier curve has to face this deliberately.
    let peak = 0
    const STEPS = 2000
    for (let i = 0; i < STEPS; i++) {
      const a = i / STEPS
      const b = (i + 1) / STEPS
      peak = Math.max(peak, (easeCameraFlight(b) - easeCameraFlight(a)) / (b - a))
    }
    expect(peak).toBeLessThan(3)
    // And it must not be reached in the opening fifth, where a spike reads as a
    // jump rather than an acceleration.
    expect(easeCameraFlight(0.2)).toBeLessThan(0.3)
  })

  it('holds the control points it was tuned to', () => {
    // Values sampled from cubic-bezier(0.45, 0.25, 0.2, 1). These are a tuning
    // decision made against the real map, not a derivation — if they change,
    // someone should have watched the camera and meant it.
    expect(easeCameraFlight(0.1)).toBeCloseTo(0.073, 2)
    expect(easeCameraFlight(0.25)).toBeCloseTo(0.296, 2)
    expect(easeCameraFlight(0.5)).toBeCloseTo(0.814, 2)
  })
})
