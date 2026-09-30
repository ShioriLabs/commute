import { HOLIDAYS } from '@commute/constants'
import type { CompactSchedule } from '@commute/schemas'

/*
 * The service day: the night belongs to the day it started on.
 *
 * Timetables store a 00:34 departure as 00:34, not 24:34, so anything that
 * sorts or buckets by the clock alone puts Friday night's last train at the
 * start of Saturday. Everything here reorders by where a departure falls in
 * the SERVICE day instead.
 */

const DAY_MINUTES = 1440

/*
 * When the night hands over to the next service day.
 *
 * 03:00 sits between the latest last train (KCI Bogor line, 01:07) and the
 * earliest first one (KCI Rangkasbitung line, 03:47), so no departure is ever
 * read as belonging to the wrong day. Only used to pick which day's BOARD to
 * fetch; ordering within a line uses that line's own overnight gap below.
 */
const ROLLOVER_HOUR = 3

export type ServiceDayName = 'WD' | 'SAT' | 'SUN'

/**
 * Which day's timetable is running now, as the API's `?day=` names it.
 *
 * The API resolves an absent `day` by calendar date, which at 00:30 on a
 * Saturday serves the SAT board while Friday night's trains are still running
 * off the WD one. Asking for the service day explicitly closes that gap.
 *
 * Device-local time, like parseMinute: the app already assumes the rider's
 * clock is on WIB. Holidays run a Sunday service, mirroring the API's own
 * `serviceDay`, and read from the same list.
 */
export function serviceDayOf(now: Date): ServiceDayName {
  const day = new Date(now.getTime() - ROLLOVER_HOUR * 3600_000)
  const iso = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`
  if (HOLIDAYS.has(iso)) return 'SUN'
  const weekday = day.getDay()
  if (weekday === 0) return 'SUN'
  if (weekday === 6) return 'SAT'
  return 'WD'
}

/**
 * The service day after the one running now, whose board holds tomorrow's
 * first trains. A day later on the clock is always the next service day, since
 * both sides of the shift sit the same distance from the rollover.
 */
export function nextServiceDayOf(now: Date): ServiceDayName {
  return serviceDayOf(new Date(now.getTime() + 24 * 3600_000))
}

/**
 * The minute a line's service day starts, or null when it never stops.
 *
 * A port of `windowFromDepartures` in @commute/tsundere (the web app does not
 * depend on the engine): the start is the departure after the largest circular
 * gap. Neither min/max nor a fixed cutoff works — KCI lines have departures at
 * both 00:00 and 23:59 — while the overnight break is unmistakable, hours long
 * against a daytime gap of minutes.
 *
 * Take it over a whole LINE, not one destination. A peak-only short-turn has a
 * midday gap longer than its night, and would put its "service start" at 16:00.
 */
export function serviceStartMinute(minutes: readonly number[], minGapMinutes = 90): number | null {
  const times = [...new Set(minutes)].sort((a, b) => a - b)
  if (times.length < 2) return null

  let largest = -1
  let lastBeforeGap = -1
  for (let i = 0; i < times.length; i++) {
    const gap = (times[(i + 1) % times.length]! - times[i]! + DAY_MINUTES) % DAY_MINUTES
    if (gap > largest) {
      largest = gap
      lastBeforeGap = i
    }
  }
  if (largest < minGapMinutes) return null
  return times[(lastBeforeGap + 1) % times.length]!
}

/** Minutes into the service day. The sort key for "later tonight". */
export function servicePosition(minute: number, start: number): number {
  return ((minute - start) % DAY_MINUTES + DAY_MINUTES) % DAY_MINUTES
}

/** The last `n` departures of the service day, earliest first. */
export function lastDepartures(schedules: readonly CompactSchedule[], start: number, n = 3): CompactSchedule[] {
  return [...schedules]
    .sort((a, b) => servicePosition(a[1], start) - servicePosition(b[1], start))
    .slice(-n)
}

/** The first departure of the service day. */
export function firstDeparture(schedules: readonly CompactSchedule[], start: number): CompactSchedule | undefined {
  let first: CompactSchedule | undefined
  for (const schedule of schedules) {
    if (!first || servicePosition(schedule[1], start) < servicePosition(first[1], start)) first = schedule
  }
  return first
}

/*
 * Is the rider waiting for TODAY's first departure rather than tomorrow's?
 *
 * Both sit in the same dead zone as far as isServiceOver is concerned, but at
 * 04.10 before a 04.24 start the service day has already turned over, so the
 * restart is on the board already fetched. At 01.30 it has not, and the
 * restart is on the next day's board.
 */
export function restartsToday(nowMinute: number, start: number): boolean {
  return nowMinute >= ROLLOVER_HOUR * 60 && nowMinute < start
}

/**
 * Has the last departure gone?
 *
 * True from the minute after it until the line's next start, which is the
 * whole overnight dead zone: 01:30 and 03:30 are both past a 00:47 last train
 * in service-day terms, since each sits later in the day than it does.
 */
export function isServiceOver(nowMinute: number, lastMinute: number, start: number): boolean {
  return servicePosition(nowMinute, start) > servicePosition(lastMinute, start)
}

/** Minutes since local midnight, the unit compact schedules use. */
export function minuteOfDay(date: Date): number {
  return date.getHours() * 60 + date.getMinutes()
}
