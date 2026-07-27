import { describe, expect, it } from 'vitest'
import {
  RELATIVE_DEPARTURE_WINDOW_MINUTES,
  getRelativeDepartureLabel,
  isImminentDeparture
} from './schedules'

const at = (base: Date, minutesFromNow: number) => new Date(base.getTime() + minutesFromNow * 60000)

describe('getRelativeDepartureLabel', () => {
  const now = new Date('2026-07-27T08:00:00')

  it('renders a just-departed train as Sekarang', () => {
    expect(getRelativeDepartureLabel(now, at(now, -1))).toBe('Sekarang')
  })

  it('renders departures within a minute as Sekarang', () => {
    expect(getRelativeDepartureLabel(now, at(now, 0))).toBe('Sekarang')
    expect(getRelativeDepartureLabel(now, at(now, 1))).toBe('Sekarang')
  })

  it('renders minutes for departures inside the window', () => {
    expect(getRelativeDepartureLabel(now, at(now, 2))).toBe('2 mnt')
    expect(getRelativeDepartureLabel(now, at(now, 29))).toBe('29 mnt')
  })

  // The reason the window moved from 15 to 30: these used to fall back to an
  // absolute clock time, putting adjacent rows in mixed units.
  it('keeps the 15-30 minute band relative', () => {
    expect(getRelativeDepartureLabel(now, at(now, 15))).toBe('15 mnt')
    expect(getRelativeDepartureLabel(now, at(now, 22))).toBe('22 mnt')
  })

  it('falls back to absolute at and beyond the window', () => {
    expect(getRelativeDepartureLabel(now, at(now, RELATIVE_DEPARTURE_WINDOW_MINUTES))).toBeNull()
    expect(getRelativeDepartureLabel(now, at(now, 45))).toBeNull()
  })

  it('falls back to absolute for stale rows well in the past', () => {
    expect(getRelativeDepartureLabel(now, at(now, -120))).toBeNull()
  })
})

describe('isImminentDeparture', () => {
  const now = new Date('2026-07-27T08:00:00')

  it('flags departures in the next three minutes', () => {
    expect(isImminentDeparture(now, at(now, 0))).toBe(true)
    expect(isImminentDeparture(now, at(now, 3))).toBe(true)
  })

  it('flags a train that just left', () => {
    expect(isImminentDeparture(now, at(now, -1))).toBe(true)
  })

  it('ignores departures further out', () => {
    expect(isImminentDeparture(now, at(now, 4))).toBe(false)
    expect(isImminentDeparture(now, at(now, 20))).toBe(false)
  })

  // getNextSchedules retains the first departure of the day when nothing
  // upcoming matches; that row must not pulse as if a train were arriving.
  it('ignores stale first-train-of-day rows in the past', () => {
    expect(isImminentDeparture(now, at(now, -240))).toBe(false)
  })
})
