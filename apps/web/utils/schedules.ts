import type { CompactSchedule } from 'models/schedules'

export function parseTime(timeString: string) {
  return new Date(`${new Date().toDateString()} ${timeString}`)
}

// parseTime pins every "HH:MM" to today, so post-midnight service (00:xx–03:xx)
// sorts ahead of tonight's late-evening departures. During late night, roll
// those after-midnight times forward a day so chronological ordering holds.
export function departureSortKey(parsed: Date, now: Date): number {
  const key = parsed.getTime()
  if (now.getHours() >= 21 && parsed.getHours() < 4) {
    return key + 24 * 60 * 60 * 1000
  }
  return key
}

export function isImmediateDeparture(now: Date, scheduledDeparture: Date) {
  const diff = scheduledDeparture.getTime() - now.getTime()
  return diff >= -60000 && diff <= 60000
}

export const RELATIVE_DEPARTURE_WINDOW_MINUTES = 15

// Returns 'Sekarang' | '<n> mnt' when the departure is within the relative
// window, or null when the absolute time should be shown instead. The -1
// lower bound keeps just-departed trains relative, while departures that
// parseTime pinned to the wrong day (cross-midnight schedules, the
// first-train-of-day fallback) fall far below it and stay absolute.
export function getRelativeDepartureLabel(now: Date, departure: Date): string | null {
  const minutes = Math.round((departure.getTime() - now.getTime()) / 60000)
  if (minutes < -1 || minutes >= RELATIVE_DEPARTURE_WINDOW_MINUTES) return null
  return minutes <= 1 ? 'Sekarang' : `${minutes} mnt`
}

// Pick the next `limit` departures from a destination's schedule list, sorted
// chronologically (with the late-night cross-midnight roll from
// departureSortKey). `now` is passed in so callers control the clock. When
// nothing upcoming remains (past the last train of the day), fall back to the
// first train of the day so the UI still shows something.
export function getNextSchedules(
  schedules: CompactSchedule[],
  now: Date,
  limit = 3
): CompactSchedule[] {
  const cutoff = now.getTime() - 60000 /* keep just departed trains */

  const upcoming = schedules
    .map(schedule => ({
      schedule,
      sortKey: departureSortKey(parseTime(schedule.estimatedDeparture), now)
    }))
    .filter(entry => entry.sortKey >= cutoff)
    .sort((a, b) => a.sortKey - b.sortKey)
    .slice(0, limit)
    .map(entry => entry.schedule)

  if (upcoming.length === 0 && schedules.length > 0) {
    return [schedules[0]]
  }

  return upcoming
}
