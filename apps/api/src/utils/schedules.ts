import { CompactSchedule, GroupingSchedule, PublicSchedule, Schedule } from 'db/schemas/schedules'

// Parses a wall-clock "HH:MM[:SS]" string into minutes since midnight. The stored
// value is already Asia/Jakarta local time, so we read the fields literally rather
// than routing through Date (Workers run in UTC, which would shift the result).
function toMinuteOfDay(value: string): number {
  const [hours, minutes] = value.split(':')
  return Number(hours) * 60 + Number(minutes)
}

/** A departure window, as minutes since local midnight. */
export interface TimeWindow {
  fromMinute: number
  toMinute: number
}

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/

/*
 * Parses one `HH:MM` query param. Strict on purpose: a caller who sends `9:00`
 * or `25:00` has a bug, and silently treating it as "no filter" would hand them
 * a full day's timetable that looks like a successful narrow query.
 */
export function parseClockParam(value: string | undefined): number | null {
  if (value === undefined) return null
  const match = HHMM.exec(value)
  if (!match) return null
  return Number(match[1]) * 60 + Number(match[2])
}

/*
 * Builds the window from the two query params, snapped to whole hours.
 *
 * The window is a range of hour buckets, not an arbitrary span: `from` floors
 * to its hour and `to` ceilings to the end of its hour, so `12:13`–`15:18`
 * becomes `12:00`–`15:59` (buckets 12, 13, 14, 15). Snapping only ever widens,
 * so a caller never loses a departure they asked for — the alternative, both
 * ends flooring, would silently drop the 15:18 departure in that example.
 *
 * `from == to` means the whole day rather than an empty window: a timetable is
 * a cycle, so the two ends of an equal window are the same instant and the span
 * between them going forward is all 1440 minutes. It also makes
 * `?from=00:00&to=00:00` — the obvious way to ask for "everything" — do what it
 * looks like.
 *
 * That test is on the exact values, not the snapped hours: `12:13`–`12:47` is a
 * request for one bucket and stays one bucket, while `12:13`–`12:13` is the
 * same instant twice and means the day.
 *
 * Returns null when neither param is present, meaning no filtering at all.
 * Returns `invalid` when a param is malformed, which the route turns into a 400
 * rather than quietly serving the unfiltered day.
 */
export function parseTimeWindow(
  fromRaw: string | undefined,
  toRaw: string | undefined
): TimeWindow | null | 'invalid' {
  if (fromRaw === undefined && toRaw === undefined) return null

  const from = parseClockParam(fromRaw)
  const to = parseClockParam(toRaw)

  // Present but unparseable is an error; absent is an open end.
  if ((fromRaw !== undefined && from === null) || (toRaw !== undefined && to === null)) {
    return 'invalid'
  }

  // One-sided windows run to the end (or from the start) of the service day.
  const fromMinute = from ?? 0
  const toMinute = to ?? 1439

  // The same instant twice means the whole day (see above). Checked before
  // snapping so a one-bucket request like 12:13-12:47 is not mistaken for it.
  if (from !== null && to !== null && from === to) {
    return { fromMinute: 0, toMinute: 0 }
  }

  // Floor the start, ceiling the end to the last minute of its bucket.
  return {
    fromMinute: Math.floor(fromMinute / 60) * 60,
    toMinute: Math.floor(toMinute / 60) * 60 + 59
  }
}

/*
 * Is a departure inside the window?
 *
 * Windows wrap past midnight: `22:00`–`02:00` is late-night service, not an
 * empty set. That matters here specifically — Koridor 1 runs 24h and KCI's last
 * trains cross midnight, so the wrapping case is the one a rider most needs.
 *
 * The bounds are inclusive at both ends. A departure exactly at `to` is the kind
 * of thing a caller asking for `06:00`–`09:00` expects to see, and excluding it
 * makes the last minute of a window silently invisible.
 */
export function isWithinWindow(minute: number, window: TimeWindow): boolean {
  const { fromMinute, toMinute } = window
  if (fromMinute === toMinute) return true // full day, see parseTimeWindow
  if (fromMinute < toMinute) return minute >= fromMinute && minute <= toMinute
  return minute >= fromMinute || minute <= toMinute // wraps midnight
}

/**
 * Cache-key fragment for a window. `all` when unfiltered, so the unfiltered
 * body keeps a stable key rather than one that depends on param spelling.
 */
export function windowCacheKey(window: TimeWindow | null): string {
  return window ? `w${window.fromMinute}-${window.toMinute}` : 'all'
}

/** Filters rows to a departure window, reading the stored local wall clock. */
export function filterByWindow<T extends { estimatedDeparture: unknown }>(
  schedules: T[],
  window: TimeWindow
): T[] {
  return schedules.filter(schedule =>
    isWithinWindow(toMinuteOfDay(schedule.estimatedDeparture as string), window))
}

// Compact mode emits wire-optimized [tripNumber, minuteSinceMidnight] tuples
// (satisfied by the projected GroupingSchedule rows); full mode projects each
// row to the public departure shape.
export function mapSchedule(schedules: Schedule[], compactMode?: false): PublicSchedule[]
export function mapSchedule(schedules: GroupingSchedule[], compactMode: true): CompactSchedule[]
export function mapSchedule(schedules: GroupingSchedule[], compactMode = false) {
  if (compactMode) {
    return schedules.map((schedule): CompactSchedule => [
      schedule.tripNumber,
      toMinuteOfDay(schedule.estimatedDeparture as unknown as string)
    ])
  }

  // Projected, not passed through: a departure is always read in the context of
  // the station and line that own it, so the row id, stationId and timestamps
  // were noise.
  return schedules.map((schedule): PublicSchedule => ({
    tripNumber: schedule.tripNumber,
    estimatedDeparture: schedule.estimatedDeparture as unknown as string,
    boundFor: schedule.boundFor,
    lineCode: schedule.lineCode
  }))
}
