import { describe, expect, it } from 'vitest'
import { haversineMeters } from 'utils/geo'

describe('haversineMeters', () => {
  it('returns 0 for identical points', () => {
    expect(haversineMeters(-6.2, 106.8, -6.2, 106.8)).toBe(0)
  })

  it('approximates ~111 km per degree of latitude', () => {
    // 1 degree of latitude is ~111.2 km anywhere on the globe.
    const d = haversineMeters(0, 0, 1, 0)
    expect(d).toBeGreaterThan(111_000)
    expect(d).toBeLessThan(111_400)
  })

  it('is symmetric', () => {
    const ab = haversineMeters(-6.2, 106.8, -6.9, 107.6)
    const ba = haversineMeters(-6.9, 107.6, -6.2, 106.8)
    expect(ab).toBe(ba)
  })

  it('handles antipodal points without NaN (asin clamp)', () => {
    // Without the Math.min(1, …) clamp, floating-point overshoot would push
    // asin above 1 and yield NaN. Distance should approach half the Earth's
    // circumference (~20,015 km).
    const d = haversineMeters(0, 0, 0, 180)
    expect(Number.isNaN(d)).toBe(false)
    expect(d).toBeGreaterThan(20_000_000)
    expect(d).toBeLessThan(20_020_000)
  })

  it('handles southern/western (negative) coordinates', () => {
    const d = haversineMeters(-6.2, 106.8, -7.8, 110.4)
    expect(d).toBeGreaterThan(0)
    expect(Number.isNaN(d)).toBe(false)
  })

  it('handles the poles', () => {
    const d = haversineMeters(90, 0, -90, 0)
    expect(Number.isNaN(d)).toBe(false)
    // Pole-to-pole is half the circumference (~20,015 km).
    expect(d).toBeGreaterThan(20_000_000)
  })

  it('measures the short way across the antimeridian', () => {
    // sin(dLng/2)^2 is periodic, so the raw (unnormalized) dLng of -358 deg
    // yields the same value as the +2 deg short hop — the formula naturally
    // takes the short way. 2 deg of longitude at the equator is ~222 km.
    const across = haversineMeters(0, 179, 0, -179)
    const equivalent = haversineMeters(0, 179, 0, 181)
    expect(across).toBeCloseTo(equivalent, 5)
    expect(across).toBeGreaterThan(222_000)
    expect(across).toBeLessThan(223_000)
  })
})
