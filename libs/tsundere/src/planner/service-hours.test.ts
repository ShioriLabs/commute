import { describe, expect, it } from 'vitest'
import { DAY_S, inWindow, windowFromDepartures, type ServiceWindow } from './service-hours'

const at = (h: number, m = 0) => h * 3600 + m * 60

describe('inWindow', () => {
  describe('a window inside one day', () => {
    const window: ServiceWindow = [at(5), at(22)]

    it('includes both ends', () => {
      expect(inWindow(at(5), window)).toBe(true)
      expect(inWindow(at(22), window)).toBe(true)
    })

    it('excludes either side', () => {
      expect(inWindow(at(4, 59), window)).toBe(false)
      expect(inWindow(at(22, 1), window)).toBe(false)
      expect(inWindow(at(3), window)).toBe(false)
    })
  })

  /*
   * The case the modular branch exists for. KCI's Bogor line runs 03:50 until
   * 01:07 the next morning, so a plain `t >= start && t <= end` matches nothing
   * at all — silently closing a line that runs almost around the clock.
   */
  describe('a window crossing midnight', () => {
    const overnight: ServiceWindow = [at(3, 50), at(1, 7)]

    it('includes the late-night tail after midnight', () => {
      expect(inWindow(at(0, 30), overnight)).toBe(true)
      expect(inWindow(at(1, 7), overnight)).toBe(true)
    })

    it('includes the daytime body', () => {
      expect(inWindow(at(3, 50), overnight)).toBe(true)
      expect(inWindow(at(12), overnight)).toBe(true)
      expect(inWindow(at(23, 59), overnight)).toBe(true)
    })

    it('excludes the dead zone between last and first train', () => {
      expect(inWindow(at(1, 8), overnight)).toBe(false)
      expect(inWindow(at(2), overnight)).toBe(false)
      expect(inWindow(at(3, 49), overnight)).toBe(false)
    })
  })

  it('treats a full-day window as always in service', () => {
    const allDay: ServiceWindow = [0, DAY_S - 1]
    for (const hour of [0, 3, 12, 23]) expect(inWindow(at(hour), allDay)).toBe(true)
  })
})

describe('windowFromDepartures', () => {
  /*
   * Line B's real hourly shape, from the production schedules table: 7470
   * departures with only four between 01:00 and 03:59.
   *
   * This fixture is the regression for two rejected approaches at once.
   * MIN/MAX reports 00:00-23:59 because the line has departures at both ends of
   * the clock. Percentiles report ~00:18-23:43 for the same reason — the window
   * wraps midnight, so its two ends sit at opposite ends of a linear sort and
   * trimming tails cuts real service while still spanning the whole day.
   * Neither filters anything; both would silently disable the feature.
   */
  const lineB = (() => {
    const perHour: Record<number, number> = {
      0: 63, 1: 2, 3: 2, 4: 147, 5: 357, 6: 450, 7: 477, 8: 439, 9: 437,
      10: 376, 11: 344, 12: 325, 13: 333, 14: 382, 15: 445, 16: 453,
      17: 470, 18: 457, 19: 413, 20: 370, 21: 316, 22: 252, 23: 160
    }
    const times: number[] = []
    for (const [hour, count] of Object.entries(perHour)) {
      /*
       * Spread each hour's departures evenly across its 60 minutes. Distinct
       * times matter: a busy hour that collapsed onto a handful of minutes
       * would manufacture gaps the real timetable does not have.
       */
      const step = Math.max(1, Math.floor(60 / count))
      for (let i = 0; i < count && i * step < 60; i++) times.push(at(Number(hour)) + i * step * 60)
    }
    return times
  })()

  it('finds the overnight break rather than the clock extremes', () => {
    const window = windowFromDepartures(lineB)
    expect(window).not.toBeNull()
    const [startS, endS] = window!

    // The window lands in the small hours at both ends, not on the clock's edges.
    expect(startS).toBeGreaterThanOrEqual(at(1))
    expect(startS).toBeLessThanOrEqual(at(4, 30))
    expect(endS).toBeLessThanOrEqual(at(3))

    // The two answers this method exists to avoid: MIN/MAX gives 00:00-23:59
    // and percentiles give ~00:18-23:43, both of which filter nothing.
    expect(window).not.toEqual([0, at(23, 59)])
    expect(endS).toBeLessThan(at(4)) // not a full-day span
    expect(startS).toBeGreaterThan(endS) // it crosses midnight
  })

  it('leaves the dead zone out and keeps the service hours in', () => {
    const window = windowFromDepartures(lineB)!
    // The middle of the overnight break, whichever side of 03:00 it falls.
    expect(inWindow(at(2), window)).toBe(false)
    // Daytime service, and the tail that runs past midnight.
    expect(inWindow(at(8), window)).toBe(true)
    expect(inWindow(at(23), window)).toBe(true)
    expect(inWindow(at(0, 30), window)).toBe(true)
  })

  it('reads a plain daytime line off its first and last departure', () => {
    const times = []
    for (let t = at(5); t <= at(23, 30); t += 600) times.push(t)
    expect(windowFromDepartures(times)).toEqual([at(5), at(23, 30)])
  })

  /*
   * TJ's AMARI night corridors run genuinely round the clock. Asserting a
   * window for them would close a service that never stops.
   */
  it('returns null when no gap is long enough to be an overnight break', () => {
    const times = []
    for (let t = 0; t < DAY_S; t += 900) times.push(t)
    expect(windowFromDepartures(times)).toBeNull()
  })

  it('returns null when there is nothing to measure', () => {
    expect(windowFromDepartures([])).toBeNull()
    expect(windowFromDepartures([at(6)])).toBeNull()
  })

  it('ignores duplicate departure times', () => {
    const times = []
    for (let t = at(5); t <= at(22); t += 600) times.push(t, t, t)
    expect(windowFromDepartures(times)).toEqual([at(5), at(22)])
  })
})
