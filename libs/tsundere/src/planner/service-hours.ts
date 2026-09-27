/*
 * Service windows: when a line runs, as seconds since local midnight.
 *
 * The engine stays timezone-free — it never learns that "local" means WIB.
 * apps/api converts a Date to seconds-since-midnight and passes the number in,
 * the same way it already passes distances rather than coordinates.
 */

/**
 * `[startS, endS]`, seconds since local midnight.
 *
 * `endS < startS` means the window crosses midnight, which is the normal case
 * for a rail line: KCI's Bogor line runs 03:50 to 01:07 the next morning.
 */
export type ServiceWindow = readonly [startS: number, endS: number]

export const DAY_S = 86400

/*
 * Is `t` inside the window?
 *
 * The modular branch is the whole point. A line running 03:50-01:07 has
 * `startS > endS`, so the plain `t >= start && t <= end` that reads correctly
 * for 05:00-22:00 matches NOTHING for the overnight line — every hour of the
 * day fails one half of the test. Getting this wrong does not throw; it
 * silently closes a line that runs all night, which is the opposite of the bug
 * this whole feature exists to fix.
 *
 * Both ends are inclusive, matching the timetable endpoints' existing
 * hour-window filtering.
 */
export function inWindow(t: number, [startS, endS]: ServiceWindow): boolean {
  return startS <= endS
    ? t >= startS && t <= endS
    : t >= startS || t <= endS
}

/**
 * The service window implied by a set of departure times, or null when the
 * line runs continuously enough that no window should be asserted.
 *
 * Takes the complement of the largest circular gap between consecutive
 * departures. `MIN`/`MAX` cannot work here: KCI lines B, C and R all have
 * departures at both 00:00 and 23:59, so extremes report a 24-hour service and
 * filter nothing. Percentiles cannot work either — a window that wraps midnight
 * has its two ends at opposite ends of a linear sort, so trimming the tails
 * eats real service at both ends and still reports ~00:00-23:59.
 *
 * The gap is unambiguous in practice: on every rail line here the largest gap
 * is 163-323 minutes while the second-largest is under 13, so there is exactly
 * one overnight break and no tuning constant is needed to find it.
 *
 * `minGapS` guards the genuinely round-the-clock case. TransJakarta's AMARI
 * night corridors have no break worth calling one, and inventing a window for
 * them would close a service that genuinely runs 24 hours.
 */
export function windowFromDepartures(
  departures: readonly number[],
  minGapS = 90 * 60
): ServiceWindow | null {
  const times = [...new Set(departures)].sort((a, b) => a - b)
  if (times.length < 2) return null

  let largest = -1
  let lastBeforeGap = -1
  for (let i = 0; i < times.length; i++) {
    // Wraps at the end: the gap from the last departure round to the first.
    const gap = (times[(i + 1) % times.length]! - times[i]! + DAY_S) % DAY_S
    if (gap > largest) {
      largest = gap
      lastBeforeGap = i
    }
  }
  if (largest < minGapS) return null

  /*
   * The gap runs FROM `times[lastBeforeGap]`, so that departure is the last of
   * the service day and the one after it is the first of the next. Reversing
   * these two yields the dead zone instead of the service window — the same
   * answer inverted, which reads plausibly and filters exactly backwards.
   */
  return [times[(lastBeforeGap + 1) % times.length]!, times[lastBeforeGap]!]
}
