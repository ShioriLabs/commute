import { describe, expect, it } from 'vitest'
import { DAY_HEADWAYS_S, HEADWAYS_S, LINE_DAY_MASK } from '../data/headways'
import { dayBits, packDayMask, type CalendarRow } from './generateHeadways'

/*
 * The five services TransJakarta's calendar.txt actually declares, plus the two
 * stale ones the generator drops. Kept as literal rows so a feed change that
 * alters a day column shows up here as a failing expectation rather than as a
 * silently different generated file.
 */
const SERVICES: Record<string, CalendarRow> = {
  //     mon  tue  wed  thu  fri  sat  sun
  HK: row('1', '1', '1', '1', '1', '0', '0'), // Mon-Fri
  HL: row('0', '0', '0', '0', '0', '1', '1'), // Sat+Sun
  HM: row('0', '0', '0', '0', '0', '0', '1'), // Sunday only
  HR: row('1', '1', '1', '1', '1', '1', '0'), // Mon-Sat
  SH: row('1', '1', '1', '1', '1', '1', '1') // daily
}

function row(...days: string[]): CalendarRow {
  const names = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
  return Object.fromEntries(names.map((name, i) => [name, days[i]!]))
}

describe('dayBits', () => {
  it('reads each declared service off its weekday columns', () => {
    expect(dayBits(SERVICES.HK)).toEqual(['WD'])
    expect(dayBits(SERVICES.HL)).toEqual(['SAT', 'SUN'])
    expect(dayBits(SERVICES.HM)).toEqual(['SUN'])
    expect(dayBits(SERVICES.SH)).toEqual(['WD', 'SAT', 'SUN'])
  })

  /*
   * `HR` is the reason the mask is three bits rather than a weekday/weekend
   * enum. No route uses it today, but the service IS declared, so a feed
   * refresh that activates it must resolve on its own.
   */
  it('resolves Mon-Sat without a special case', () => {
    expect(dayBits(SERVICES.HR)).toEqual(['WD', 'SAT'])
    expect(packDayMask(dayBits(SERVICES.HR!))).toBe(0b110)
  })

  it('treats an unknown service as running on no day', () => {
    expect(dayBits(undefined)).toEqual([])
    expect(packDayMask([])).toBe(0)
  })

  // Every weekday column collapses to one bucket: no TJ route differs within
  // Mon-Fri, so a service running only Wednesday is still just a weekday one.
  it('collapses the five weekday columns into a single WD bit', () => {
    expect(dayBits(row('0', '0', '1', '0', '0', '0', '0'))).toEqual(['WD'])
  })
})

describe('packDayMask', () => {
  it('packs WD|SAT|SUN into the high-to-low bit order the generated file uses', () => {
    expect(packDayMask(['WD'])).toBe(0b100)
    expect(packDayMask(['SAT'])).toBe(0b010)
    expect(packDayMask(['SUN'])).toBe(0b001)
    expect(packDayMask(['WD', 'SAT', 'SUN'])).toBe(0b111)
  })
})

describe('LINE_DAY_MASK', () => {
  it('records the two Sunday-only corridors as Sunday, not as weekend', () => {
    expect(LINE_DAY_MASK['7T']).toBe(0b001)
    expect(LINE_DAY_MASK['8A']).toBe(0b001)
  })

  /*
   * 13E and L13E are the all-stops and Express variants of one corridor,
   * running on complementary days. This pair is the feature's motivating case.
   */
  it('splits 13E and L13E across the week', () => {
    expect(LINE_DAY_MASK['13E']).toBe(0b011)
    expect(LINE_DAY_MASK.L13E).toBe(0b100)
  })

  it('omits lines that run every day, so absent means 0b111', () => {
    expect(LINE_DAY_MASK['1']).toBeUndefined()
    expect(LINE_DAY_MASK['9C']).toBeUndefined()
  })
})

describe('DAY_HEADWAYS_S', () => {
  /*
   * The measurement the three-bit scheme exists for. TJ's `HM` service ADDS
   * Sunday trips on top of 9C's everyday `SH` service rather than replacing it,
   * so the corridor combines to 514s Mon-Sat and 212s on Sunday.
   *
   * A single weekend bucket cannot express this. Built as "Saturday OR Sunday"
   * it emits 212s and promises Saturday riders a bus every 3.5 minutes where
   * one comes every 8.5; built as "Saturday AND Sunday" it emits 514s and
   * discards the real Sunday service. Hence separate SAT and SUN.
   */
  it('carries 9C\'s extra Sunday service without touching its Saturday figure', () => {
    expect(HEADWAYS_S['9C']).toBe(514)
    expect(DAY_HEADWAYS_S['SUN:9C']).toBe(212)
    expect(DAY_HEADWAYS_S['SAT:9C']).toBeUndefined()
  })

  it('is sparse: a day absent here means the weekday value applies', () => {
    for (const key of Object.keys(DAY_HEADWAYS_S)) {
      expect(key).toMatch(/^(SAT|SUN):/)
    }
    // A weekday-keyed entry would mean the delta layer had shadowed its own base.
    expect(Object.keys(DAY_HEADWAYS_S).some(k => k.startsWith('WD:'))).toBe(false)
  })

  /*
   * Weekend-only corridors previously carried no number at all — the halte page
   * said "Akhir pekan saja" and stopped there. They now have real figures.
   */
  it('gives the weekend-only corridors a real frequency', () => {
    expect(DAY_HEADWAYS_S['SAT:13E']).toBe(400)
    expect(DAY_HEADWAYS_S['SUN:13E']).toBe(400)
    expect(DAY_HEADWAYS_S['SAT:9N']).toBe(1020)
  })
})
