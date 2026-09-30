import { describe, expect, it } from 'vitest'
import type { CompactSchedule } from '@commute/schemas'
import { firstDeparture, isServiceOver, lastDepartures, nextServiceDayOf, restartsToday, serviceDayOf, servicePosition, serviceStartMinute } from './service-day'

const hm = (h: number, m: number) => h * 60 + m
const row = (minute: number): CompactSchedule => [null, minute]

// A Bogor-line-shaped night: runs 03:50 until 01:07 the next morning.
// Every 20 minutes through the day, then the late tail.
const overnight = [
  ...Array.from({ length: 60 }, (_, i) => hm(3, 50) + i * 20),
  hm(23, 52), hm(0, 0), hm(0, 34), hm(1, 7)
]

describe('serviceDayOf', () => {
  it('keeps the night on the day it started', () => {
    // 00:30 Saturday is still Friday night's service.
    expect(serviceDayOf(new Date('2026-10-03T00:30:00'))).toBe('WD')
    expect(serviceDayOf(new Date('2026-10-03T03:00:00'))).toBe('SAT')
    expect(serviceDayOf(new Date('2026-10-04T01:00:00'))).toBe('SAT')
    expect(serviceDayOf(new Date('2026-10-05T01:00:00'))).toBe('SUN')
  })

  it('runs holidays as Sunday', () => {
    // 2026-05-01, Hari Buruh, is a Friday.
    expect(serviceDayOf(new Date('2026-05-01T12:00:00'))).toBe('SUN')
    // The small hours after it are still the holiday's service.
    expect(serviceDayOf(new Date('2026-05-02T00:30:00'))).toBe('SUN')
  })
})

describe('serviceStartMinute', () => {
  it('starts the day after the overnight gap, not at midnight', () => {
    expect(serviceStartMinute(overnight)).toBe(hm(3, 50))
  })

  it('reports no start for a line that never stops', () => {
    const allNight = Array.from({ length: 48 }, (_, i) => i * 30)
    expect(serviceStartMinute(allNight)).toBeNull()
  })
})

describe('lastDepartures', () => {
  it('orders past midnight as later, like the platform does', () => {
    const start = serviceStartMinute(overnight)!
    expect(lastDepartures(overnight.map(row), start).map(r => r[1]))
      .toEqual([hm(0, 0), hm(0, 34), hm(1, 7)])
  })
})

describe('isServiceOver', () => {
  const start = hm(3, 50)
  const last = hm(0, 47)

  it('is running up to and including the last departure', () => {
    expect(isServiceOver(hm(23, 30), last, start)).toBe(false)
    expect(isServiceOver(hm(0, 47), last, start)).toBe(false)
  })

  it('is over through the whole dead zone', () => {
    expect(isServiceOver(hm(0, 48), last, start)).toBe(true)
    expect(isServiceOver(hm(3, 30), last, start)).toBe(true)
  })

  it('is running again once the day starts', () => {
    expect(isServiceOver(hm(3, 50), last, start)).toBe(false)
  })

  it('positions minutes relative to the start', () => {
    expect(servicePosition(hm(0, 0), start)).toBeGreaterThan(servicePosition(hm(23, 0), start))
  })
})

describe('restarting', () => {
  it('names the next service day, holidays included', () => {
    // Friday night, before and after midnight: tomorrow is Saturday either way.
    expect(nextServiceDayOf(new Date('2026-10-02T23:30:00'))).toBe('SAT')
    expect(nextServiceDayOf(new Date('2026-10-03T01:30:00'))).toBe('SAT')
    // Thursday 30 April 2026: the Friday after is Hari Buruh.
    expect(nextServiceDayOf(new Date('2026-04-30T22:00:00'))).toBe('SUN')
  })

  it('finds the first departure after the overnight gap, not at midnight', () => {
    const start = serviceStartMinute(overnight)!
    expect(firstDeparture(overnight.map(row), start)?.[1]).toBe(hm(3, 50))
  })

  it('restarts today only between the rollover and the first departure', () => {
    const start = hm(4, 24)
    expect(restartsToday(hm(4, 10), start)).toBe(true)
    expect(restartsToday(hm(1, 30), start)).toBe(false)
    expect(restartsToday(hm(23, 30), start)).toBe(false)
  })
})
