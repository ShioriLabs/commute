import { describe, expect, it } from 'vitest'
import { GroupingSchedule } from 'db/schemas/schedules'
import { filterByWindow, isWithinWindow, mapSchedule, parseTimeWindow } from 'utils/schedules'

// GroupingSchedule.estimatedDeparture is typed as a Date column, but at runtime
// D1 returns the stored "HH:MM:SS" wall-clock string; cast to build fixtures.
function grouping(tripNumber: string | null, estimatedDeparture: string): GroupingSchedule {
  return {
    id: `sched-${tripNumber ?? 'x'}`,
    lineCode: 'C',
    boundFor: 'Cikarang',
    tripNumber,
    estimatedDeparture: estimatedDeparture as unknown as GroupingSchedule['estimatedDeparture']
  }
}

describe('mapSchedule compact mode', () => {
  it('emits [tripNumber, minuteSinceMidnight] tuples', () => {
    expect(mapSchedule([grouping('1234', '05:27:00')], true)).toEqual([['1234', 327]])
  })

  it('keeps a null tripNumber (operators without trip numbers)', () => {
    expect(mapSchedule([grouping(null, '00:30:00')], true)).toEqual([[null, 30]])
  })

  it('handles late-night times past 23:00', () => {
    expect(mapSchedule([grouping('7', '23:45:00')], true)).toEqual([['7', 1425]])
  })
})

describe('parseTimeWindow', () => {
  it('returns null when neither param is given (no filtering)', () => {
    expect(parseTimeWindow(undefined, undefined)).toBeNull()
  })

  it('parses a plain window, ceilinged to the end of the last bucket', () => {
    expect(parseTimeWindow('06:00', '09:00')).toEqual({ fromMinute: 360, toMinute: 599 })
  })

  /*
   * The bucketing rule: from floors, to ceilings, so the window always covers
   * everything the caller asked for. 12:13-15:18 -> buckets 12,13,14,15.
   */
  it('snaps ragged times to whole hour buckets', () => {
    expect(parseTimeWindow('12:13', '15:18')).toEqual({ fromMinute: 720, toMinute: 959 })
  })

  it('keeps a sub-hour request inside its single bucket', () => {
    expect(parseTimeWindow('12:13', '12:47')).toEqual({ fromMinute: 720, toMinute: 779 })
  })

  it('never drops a departure the caller asked for', () => {
    // 15:18 was requested, so 15:18 must still be inside the snapped window.
    const window = parseTimeWindow('12:13', '15:18')
    expect(window).not.toBe('invalid')
    expect(isWithinWindow(15 * 60 + 18, window as { fromMinute: number, toMinute: number })).toBe(true)
  })

  // The documented way to ask for the whole day.
  it('treats an equal window as the full day', () => {
    expect(parseTimeWindow('00:00', '00:00')).toEqual({ fromMinute: 0, toMinute: 0 })
    expect(parseTimeWindow('09:00', '09:00')).toEqual({ fromMinute: 0, toMinute: 0 })
    expect(isWithinWindow(0, { fromMinute: 0, toMinute: 0 })).toBe(true)
    expect(isWithinWindow(1439, { fromMinute: 0, toMinute: 0 })).toBe(true)
  })

  it('leaves a one-sided window open at the missing end', () => {
    expect(parseTimeWindow('22:00', undefined)).toEqual({ fromMinute: 1320, toMinute: 1439 })
    expect(parseTimeWindow(undefined, '06:00')).toEqual({ fromMinute: 0, toMinute: 419 })
  })

  /*
   * Malformed input must not silently degrade to "whole day" — a caller sending
   * `9:00` has a bug and should hear about it, not receive 1440 minutes of
   * departures that look like a successful narrow query.
   */
  it('rejects malformed clock values', () => {
    for (const bad of ['9:00', '25:00', '12:60', '0900', 'noon', '', '12:00:00']) {
      expect(parseTimeWindow(bad, '09:00'), bad).toBe('invalid')
    }
    expect(parseTimeWindow('06:00', '99:99')).toBe('invalid')
  })

  it('accepts the boundary values', () => {
    expect(parseTimeWindow('00:00', '23:59')).toEqual({ fromMinute: 0, toMinute: 1439 })
  })

  it('snaps a wrapping window without unwrapping it', () => {
    // 22:40-02:10 -> buckets 22,23,00,01,02
    expect(parseTimeWindow('22:40', '02:10')).toEqual({ fromMinute: 1320, toMinute: 179 })
  })
})

describe('isWithinWindow', () => {
  const morning = { fromMinute: 360, toMinute: 540 } // 06:00-09:00

  it('includes both bounds', () => {
    expect(isWithinWindow(360, morning)).toBe(true)
    expect(isWithinWindow(540, morning)).toBe(true)
  })

  it('excludes outside the window', () => {
    expect(isWithinWindow(359, morning)).toBe(false)
    expect(isWithinWindow(541, morning)).toBe(false)
  })

  /*
   * The case that matters most: Koridor 1 runs 24h and KCI's last trains cross
   * midnight, so a late-night window must wrap rather than return nothing.
   */
  describe('wrapping past midnight (22:00-02:00)', () => {
    const night = { fromMinute: 1320, toMinute: 120 }

    it('includes departures before midnight', () => {
      expect(isWithinWindow(1320, night)).toBe(true) // 22:00
      expect(isWithinWindow(1439, night)).toBe(true) // 23:59
    })

    it('includes departures after midnight', () => {
      expect(isWithinWindow(0, night)).toBe(true) // 00:00
      expect(isWithinWindow(120, night)).toBe(true) // 02:00
    })

    it('excludes the daytime gap', () => {
      expect(isWithinWindow(121, night)).toBe(false) // 02:01
      expect(isWithinWindow(720, night)).toBe(false) // midday
      expect(isWithinWindow(1319, night)).toBe(false) // 21:59
    })
  })
})

describe('filterByWindow', () => {
  const rows = [
    grouping('a', '05:30:00'),
    grouping('b', '06:00:00'),
    grouping('c', '08:15:00'),
    grouping('d', '09:00:00'),
    grouping('e', '23:30:00'),
    grouping('f', '00:45:00')
  ]

  it('keeps only departures inside a morning window', () => {
    const kept = filterByWindow(rows, { fromMinute: 360, toMinute: 540 })
    expect(kept.map(r => r.tripNumber)).toEqual(['b', 'c', 'd'])
  })

  it('keeps both sides of a window that wraps midnight', () => {
    const kept = filterByWindow(rows, { fromMinute: 1320, toMinute: 120 })
    expect(kept.map(r => r.tripNumber)).toEqual(['e', 'f'])
  })

  it('keeps everything for an equal window', () => {
    expect(filterByWindow(rows, { fromMinute: 0, toMinute: 0 })).toHaveLength(rows.length)
  })

  it('returns an empty array rather than throwing when nothing matches', () => {
    expect(filterByWindow(rows, { fromMinute: 180, toMinute: 240 })).toEqual([])
  })
})
