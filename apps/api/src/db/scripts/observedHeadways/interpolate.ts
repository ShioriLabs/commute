import { columnDayType, columnHour } from './fit'

/*
 * Filling the hours the backtest could not vouch for.
 *
 * A line-direction's profile is measured in the hours it was observed healthily
 * and absent in the rest (the weekday rush hours above all). A schedule value
 * times a global scalar is a poor stand-in there: schedule headways are clamped
 * at 120s, so the ratio varies by stop, and a stop with its own measured
 * neighbours then zig-zags between measured and scaled values across the day.
 *
 * Interpolating the line-direction's OWN profile between its nearest measured
 * hours is closer. Held out against measured cells on 2026-10-12 data, median
 * |log error| of interpolation against schedule x scale, by the gap between
 * the two measured neighbours:
 *
 *     gap  2h: 0.10 vs 0.23     gap  6h: 0.17 vs 0.24     gap 10h: 0.28 vs 0.36
 *     gap  4h: 0.13 vs 0.24     gap  8h: 0.22 vs 0.30     gap 12h: 0.31 vs 0.36
 *
 * It wins at every length, but the margin narrows and its p90 climbs towards
 * the scalar's, so the limit is a judgment: 8h closes the weekend afternoon
 * hole that appeared in the first fit while still being clearly ahead.
 *
 * Rules:
 *   - between two measured hours at most MAX_GAP_HOURS apart: linear in headway;
 *   - beyond the first or last measured hour: hold the nearest value for at
 *     most HOLD_HOURS (service tails off, so a longer hold would pretend);
 *   - anything else is left absent and falls through to the scaled schedule.
 *
 * Measured cells are never altered. The output holds only the cells added.
 */
export const MAX_GAP_HOURS = 8
export const HOLD_HOURS = 2

/** `${line}@${dir}|${column}` -> seconds, measured cells only in; interpolated cells only out. */
export function interpolateProfiles(measured: ReadonlyMap<string, number>): Map<string, number> {
  const byLineDirDay = new Map<string, Map<number, number>>()
  for (const [id, seconds] of measured) {
    const [lineDir, columnText] = id.split('|') as [string, string]
    const column = Number(columnText)
    const group = `${lineDir}|${columnDayType(column)}`
    let hours = byLineDirDay.get(group)
    if (!hours) byLineDirDay.set(group, hours = new Map())
    hours.set(columnHour(column), seconds)
  }

  const out = new Map<string, number>()
  for (const [group, hours] of byLineDirDay) {
    const [lineDir, dayType] = group.split('|') as [string, string]
    const known = [...hours.keys()].sort((a, b) => a - b)
    for (let hour = 0; hour < 24; hour++) {
      if (hours.has(hour)) continue
      const lower = [...known].reverse().find(h => h < hour)
      const upper = known.find(h => h > hour)
      let seconds: number | undefined
      if (lower !== undefined && upper !== undefined) {
        if (upper - lower <= MAX_GAP_HOURS) {
          const a = hours.get(lower)!
          const b = hours.get(upper)!
          seconds = a + ((b - a) * (hour - lower)) / (upper - lower)
        }
      } else if (lower !== undefined && hour - lower <= HOLD_HOURS) {
        seconds = hours.get(lower)
      } else if (upper !== undefined && upper - hour <= HOLD_HOURS) {
        seconds = hours.get(upper)
      }
      if (seconds === undefined) continue
      const column = (dayType === 'WD' ? 0 : 24) + hour
      out.set(`${lineDir}|${column}`, seconds)
    }
  }
  return out
}
