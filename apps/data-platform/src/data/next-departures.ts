// Computes the next N upcoming departures from a full daily grouped timetable,
// relative to the current Asia/Jakarta time. Works entirely in minutes-since-
// midnight (the compact wire format), which sidesteps the device-timezone and
// cross-midnight Date juggling in apps/web/utils/schedules.ts.
import { jakartaMinutesSinceMidnight } from './time-jakarta'
import type { CompactLineGroupedTimetable } from './schedules-types'
import { lineCodeOf, type LineDictionary } from './network-types'

const MINUTES_PER_DAY = 24 * 60
// Departures within this window render as a relative countdown ("Sekarang" /
// "<n> mnt"); further out they show absolute HH:MM. Mirrors the web app's
// RELATIVE_DEPARTURE_WINDOW_MINUTES.
const RELATIVE_WINDOW_MIN = 15

export interface DepartureRow {
  lineName: string
  lineCode: string
  color: string
  boundFor: string
  via: string | null
  platformCode: string | null
  /** Minutes from now until departure (0..MINUTES_PER_DAY), for sorting. */
  minutesUntil: number
  /** Absolute departure time, "HH:MM" in Jakarta wall-clock. */
  time: string
  /** Relative label when within the window, else null (show `time`). */
  relative: string | null
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

function absTime(minuteOfDay: number): string {
  const m = ((minuteOfDay % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY
  return `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`
}

function relativeLabel(minutesUntil: number): string | null {
  if (minutesUntil >= RELATIVE_WINDOW_MIN) return null
  return minutesUntil <= 1 ? 'Sekarang' : `${minutesUntil} mnt`
}

// Forward distance in minutes from `now` to a scheduled minute-of-day, wrapping
// past midnight so late-night viewers still see tomorrow's first trains.
function forwardDelta(nowMin: number, schedMin: number): number {
  return ((schedMin - nowMin) % MINUTES_PER_DAY + MINUTES_PER_DAY) % MINUTES_PER_DAY
}

/*
 * `lines` resolves the timetable's operator-qualified line keys (`KCI:B`) to a
 * name and colour. Passed in rather than fetched here so this stays pure — see
 * buildLineDictionary in network-types.
 */
export function nextDepartures(
  timetable: CompactLineGroupedTimetable,
  count: number,
  lines: LineDictionary,
  nowMin: number = jakartaMinutesSinceMidnight()
): DepartureRow[] {
  const rows: DepartureRow[] = []

  for (const line of timetable) {
    for (const dir of line.timetable) {
      for (const dest of dir.destinations) {
        for (const [, minute] of dest.schedules) {
          const minutesUntil = forwardDelta(nowMin, minute)
          const resolved = lines.get(line.line)
          rows.push({
            lineName: resolved?.name ?? lineCodeOf(line.line),
            lineCode: lineCodeOf(line.line),
            color: resolved?.colorCode ?? '#94a3b8',
            boundFor: dest.boundFor,
            via: dest.via,
            platformCode: dir.platformCode,
            minutesUntil,
            time: absTime(minute),
            relative: relativeLabel(minutesUntil)
          })
        }
      }
    }
  }

  rows.sort((a, b) => a.minutesUntil - b.minutesUntil)
  return rows.slice(0, count)
}
