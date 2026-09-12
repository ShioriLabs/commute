import { describe, expect, it } from 'vitest'
import {
  composeDeparture,
  DEPARTURE_HOURS,
  DEPARTURE_MINUTES,
  DEPARTURE_SLOT_MINUTES,
  departureDays,
  formatDepartureDay,
  formatDepartureLabel,
  isSameLocalDay,
  isStaleDeparture,
  quantiseToSlot,
  shiftBySlot
} from './departure-time'

/*
 * The grid the picker offers and the cache can tell apart.
 *
 * Local-time throughout, so these build dates from parts rather than parsing
 * ISO strings with an offset — a test written as '2026-07-20T08:10:00+07:00'
 * passes or fails depending on the machine's zone, which is exactly the bug
 * class this module exists to avoid.
 */
const local = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min, 0, 0)

describe('quantiseToSlot', () => {
  it('floors to the containing slot, never the next one', () => {
    expect(quantiseToSlot(local(2026, 7, 20, 8, 0)).getMinutes()).toBe(0)
    expect(quantiseToSlot(local(2026, 7, 20, 8, 19)).getMinutes()).toBe(0)
    expect(quantiseToSlot(local(2026, 7, 20, 8, 20)).getMinutes()).toBe(20)
    expect(quantiseToSlot(local(2026, 7, 20, 8, 59)).getMinutes()).toBe(40)
  })

  it('clears seconds and milliseconds, so equal slots compare equal', () => {
    const messy = new Date(local(2026, 7, 20, 8, 25).getTime() + 37_500)
    expect(quantiseToSlot(messy).getTime()).toBe(local(2026, 7, 20, 8, 20).getTime())
  })

  it('leaves the hour alone when flooring within it', () => {
    expect(quantiseToSlot(local(2026, 7, 20, 23, 59)).getHours()).toBe(23)
  })
})

describe('isSameLocalDay', () => {
  it('compares calendar days, not elapsed time', () => {
    expect(isSameLocalDay(local(2026, 7, 20, 0, 5), local(2026, 7, 20, 23, 55))).toBe(true)
    // Twenty minutes apart, but either side of midnight.
    expect(isSameLocalDay(local(2026, 7, 20, 23, 50), local(2026, 7, 21, 0, 10))).toBe(false)
  })

  it('separates the same day across months and years', () => {
    expect(isSameLocalDay(local(2026, 7, 20), local(2026, 8, 20))).toBe(false)
    expect(isSameLocalDay(local(2026, 7, 20), local(2027, 7, 20))).toBe(false)
  })
})

describe('wheel options', () => {
  it('offers every hour', () => {
    expect(DEPARTURE_HOURS).toHaveLength(24)
    expect(DEPARTURE_HOURS[0]).toBe(0)
    expect(DEPARTURE_HOURS[23]).toBe(23)
  })

  /*
   * Slot boundaries only. A wheel stepping by 1 or 5 like the reference apps
   * would let a rider pick 13.25 and be shown the 13.20 answer — the backend
   * keys on the slot, so the extra precision is a claim we cannot honour.
   */
  it('offers only minutes the cache can tell apart', () => {
    expect(DEPARTURE_MINUTES).toEqual([0, 20, 40])
    for (const minute of DEPARTURE_MINUTES) {
      expect(minute % DEPARTURE_SLOT_MINUTES).toBe(0)
    }
  })
})

describe('composeDeparture', () => {
  it('puts a wall-clock time onto a day', () => {
    const at = composeDeparture(local(2026, 7, 21), 13, 20)
    expect(at.getDate()).toBe(21)
    expect(at.getHours()).toBe(13)
    expect(at.getMinutes()).toBe(20)
  })

  it('clears seconds so two equal picks compare equal', () => {
    const day = new Date(local(2026, 7, 21).getTime() + 42_000)
    expect(composeDeparture(day, 13, 20).getTime()).toBe(composeDeparture(local(2026, 7, 21), 13, 20).getTime())
  })
})

describe('shiftBySlot', () => {
  const now = local(2026, 7, 20, 9, 5)

  it('nudges a picked time by whole slots', () => {
    const at = local(2026, 7, 20, 13, 20).toISOString()
    expect(shiftBySlot(at, 1, now).getMinutes()).toBe(40)
    expect(shiftBySlot(at, -1, now).getMinutes()).toBe(0)
  })

  // Nudging from the default is how a rider says "a bit later than now" without
  // first picking an absolute time.
  it('nudges from the current slot when following the clock', () => {
    const later = shiftBySlot('now', 1, now)
    expect(later.getHours()).toBe(9)
    expect(later.getMinutes()).toBe(20)
  })

  it('rolls across the hour and the day', () => {
    expect(shiftBySlot(local(2026, 7, 20, 13, 40).toISOString(), 1, now).getHours()).toBe(14)
    const midnight = shiftBySlot(local(2026, 7, 20, 23, 40).toISOString(), 1, now)
    expect(midnight.getDate()).toBe(21)
    expect(midnight.getHours()).toBe(0)
  })
})

describe('departureDays', () => {
  it('starts today and runs forward at local midnight', () => {
    const days = departureDays(local(2026, 7, 20, 13, 7))
    expect(days[0]!.getDate()).toBe(20)
    expect(days[0]!.getHours()).toBe(0)
    expect(days[1]!.getDate()).toBe(21)
  })

  it('rolls across a month boundary', () => {
    const days = departureDays(local(2026, 7, 30, 9, 0))
    expect(days[2]!.getMonth()).toBe(7) // August, zero-indexed
    expect(days[2]!.getDate()).toBe(1)
  })
})

describe('formatDepartureDay', () => {
  const now = local(2026, 7, 20, 9, 0)

  it('names the two days that have a common name', () => {
    expect(formatDepartureDay(local(2026, 7, 20), now)).toBe('Hari ini')
    expect(formatDepartureDay(local(2026, 7, 21), now)).toBe('Besok')
  })

  it('falls back to a date past those', () => {
    const label = formatDepartureDay(local(2026, 7, 23), now)
    expect(label).not.toBe('Hari ini')
    expect(label).not.toBe('Besok')
    expect(label).toBeTruthy()
  })

  it('compares by calendar day, not by elapsed hours', () => {
    // 23.50 today and 00.10 tomorrow are 20 minutes apart but different days.
    expect(formatDepartureDay(local(2026, 7, 21, 0, 10), local(2026, 7, 20, 23, 50))).toBe('Besok')
  })
})

describe('formatDepartureLabel', () => {
  const now = local(2026, 7, 20, 9, 0)

  it('reads as words for the follow-the-clock mode', () => {
    expect(formatDepartureLabel('now', now)).toBe('Sekarang')
  })

  it('shows the clock alone for today', () => {
    expect(formatDepartureLabel(local(2026, 7, 20, 8, 40).toISOString(), now)).toBe('08.40')
  })

  it('names the day when it is not today', () => {
    expect(formatDepartureLabel(local(2026, 7, 21, 8, 40).toISOString(), now)).toBe('Besok 08.40')
  })

  // A hand-edited URL is the realistic source. Falling back to the default mode
  // beats rendering "Invalid Date" on the button.
  it('degrades to the default mode on an unparseable value', () => {
    expect(formatDepartureLabel('not-a-date', now)).toBe('Sekarang')
  })
})

describe('isStaleDeparture', () => {
  const now = local(2026, 7, 20, 9, 0)

  it('never calls the follow-the-clock mode stale', () => {
    expect(isStaleDeparture('now', now)).toBe(false)
  })

  it('is stale once the slot has passed', () => {
    expect(isStaleDeparture(local(2026, 7, 20, 8, 40).toISOString(), now)).toBe(true)
    expect(isStaleDeparture(local(2026, 7, 19, 9, 0).toISOString(), now)).toBe(true)
  })

  /*
   * The current slot stays usable until it ends. Measured against the slot
   * rather than the instant on purpose: at 09.05 a rider who picked 09.00 is
   * still boarding that departure, and resetting them to "now" mid-slot would
   * discard a choice they can still act on.
   */
  it('keeps the slot the clock is currently inside', () => {
    expect(isStaleDeparture(local(2026, 7, 20, 9, 0).toISOString(), local(2026, 7, 20, 9, 5))).toBe(false)
  })

  it('is not stale for anything ahead', () => {
    expect(isStaleDeparture(local(2026, 7, 20, 9, 20).toISOString(), now)).toBe(false)
    expect(isStaleDeparture(local(2026, 7, 21, 8, 0).toISOString(), now)).toBe(false)
  })

  it('treats an unparseable value as stale, so it resets rather than sticks', () => {
    expect(isStaleDeparture('not-a-date', now)).toBe(true)
  })
})
