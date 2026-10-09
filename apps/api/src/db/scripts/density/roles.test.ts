import { describe, expect, it } from 'vitest'
import { amShareFor, amShiftHours, businessWeight, dayLevel, roleWeight } from './roles'

describe('businessWeight (distance decay)', () => {
  it('is high at the core and decays with ride time', () => {
    expect(businessWeight(0)).toBeGreaterThanOrEqual(0.8)
    expect(businessWeight(20)).toBeLessThan(businessWeight(5))
    expect(businessWeight(75)).toBeLessThanOrEqual(0.1)
  })

  it('falls back when ride time is unknown', () => {
    expect(businessWeight(undefined)).toBe(0.3)
  })
})

describe('roleWeight overrides', () => {
  it('makes Bogor a destination at weekends only', () => {
    expect(roleWeight('KCI-BOO', 'WD', 75)).toBeLessThanOrEqual(0.1)
    expect(roleWeight('KCI-BOO', 'SAT', 75)).toBeGreaterThanOrEqual(0.5)
    expect(roleWeight('KCI-BOO', 'SUN', 75)).toBe(roleWeight('KCI-BOO', 'SAT', 75))
  })

  it('treats Tebet as mixed whatever its ride time says', () => {
    expect(roleWeight('KCI-TEB', 'WD', 5)).toBe(0.5)
  })
})

describe('amShareFor (share of boardings before 13:00)', () => {
  it('matches the spec on weekdays: origins ~55%, business stations mostly evening', () => {
    expect(amShareFor(0.05, 'WD')).toBeGreaterThan(0.53)
    expect(amShareFor(0.05, 'WD')).toBeLessThan(0.62)
    expect(amShareFor(0.85, 'WD')).toBeLessThan(0.3)
  })

  it('runs late at weekends for everyone', () => {
    expect(amShareFor(0.05, 'SUN')).toBeLessThan(0.4)
  })
})

describe('dayLevel (weekend spectrum)', () => {
  it('is 1 on weekdays, ~0.45 at business stations and ~0.78 at far origins at weekends', () => {
    expect(dayLevel(0.5, 'WD')).toBe(1)
    expect(dayLevel(0.85, 'SAT')).toBeCloseTo(0.46, 2)
    expect(dayLevel(0.05, 'SUN')).toBeCloseTo(0.78, 2)
  })
})

describe('amShiftHours', () => {
  it('moves far origins earlier, the core later, and nothing when unknown', () => {
    expect(amShiftHours(75)).toBeCloseTo(0.75, 2)
    expect(amShiftHours(0)).toBeCloseTo(-0.5, 2)
    expect(amShiftHours(500)).toBe(1)
    expect(amShiftHours(undefined)).toBe(0)
  })
})
