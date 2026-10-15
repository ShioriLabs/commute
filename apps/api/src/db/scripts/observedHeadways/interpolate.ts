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

/*
 * A check against what the model itself saw.
 *
 * Interpolation is the right answer for an hour nobody observed (the relay was
 * down in the weekday rush hours). It is the WRONG answer for an hour that was
 * observed but could not be validated, because there the neighbours can sit on
 * the other side of a service regime: the 00:00 and 05:00 values bracket a night
 * that thins out after midnight, and a straight line between them ramps through
 * 03:00 as if buses ran every 13 minutes where the data says about 36.
 *
 * So each interpolated column is compared with the model's own (unvouched)
 * value for the same cells. Where the model has values and the interpolation
 * is, in the median, more than `tolerance` away from them, the whole column is
 * left to the scaled fallback. A column with no model values at all has nothing
 * to conflict with and is kept. Column-level on purpose: per-cell model values
 * are noisy (that is why the column did not validate), the median over a
 * column's ~30-60 cells is not.
 *
 * Measured on 2026-10-12 data the median |log(interpolated / model)| was
 * 0.08-0.23 for thin daytime columns and 0.28-1.05 for the night ones. The
 * first tolerance, 1.5x (0.41), let the two borderline night columns (0.28-0.29)
 * through and produced a visible wobble at 01:00 (19 -> 16 -> 28 minutes, on a
 * service that only thins after midnight). 1.3x (0.26) sits in the narrow gap
 * between them; if a refit moves a daytime column over it, that column simply
 * takes the measured scaled fallback, which is safe.
 */
export const CONFLICT_TOLERANCE = Math.log(1.3)

/**
 * A single interpolated cell this far from the model's own value is dropped
 * even when its column is accepted: a column's median can sit comfortably inside
 * the tolerance while a few line-directions are 4x off (`9A` at 2311s against a
 * model value of 565s). The cell then takes the scaled fallback on its own.
 */
export const CELL_VETO = Math.log(2)

export interface ConflictResult {
  accepted: Map<string, number>
  /**
   * Cells dropped because the model saw the line-direction in a column that DID
   * have data and found too few arrivals to fit a profile: evidence of little or
   * no service, which interpolation from busier hours would paper over.
   */
  sparseVetoed: number
  /** Columns dropped, whether they failed the test themselves or shared a span with one that did. */
  rejectedColumns: number[]
  /** Median |log(interp/model)| per column that had model values, for reporting margins. */
  deviations: Map<number, number>
  /** Cells dropped by the per-cell veto inside accepted columns. */
  vetoedCells: number
  /** Cells dropped because the backtest held them back (scored, and lost to the fallback). */
  heldBackDropped: number
}

/*
 * The test above is per column, which has one weakness: a night span of several
 * unmeasured hours (01-04) is ONE regime, and its columns sit at different
 * distances from the tolerance (0.29, 0.57, 0.79, 1.05). Judged one by one, a
 * refit that nudges the weakest across the line ships the ramp for that hour
 * alone, between a measured hour and a rejected one: a visible step, with no
 * test failing. So the hours between two measured hours are judged TOGETHER:
 * if any hour in such a span conflicts, the whole span is left to the fallback.
 *
 * `measuredColumns` are the columns that ship a measured profile. They define
 * the spans; a leading or trailing run before the first or after the last
 * measured hour is a span of its own.
 *
 * A third check handles what the two above cannot see. The reference only has a
 * cell where the model had enough arrivals to fit one, so a line-direction that
 * was observed in a healthy column but barely ran (7F has no scheduled service
 * 09:30-14:00) has NO reference there, which reads as "nothing to contradict
 * it", and the hour was filled from its busier neighbours (~19 minutes, labelled
 * INTERPOLATED). `dataColumns` are the columns with enough healthy days to fit
 * anything; an interpolated cell in one of them with no model value of its own
 * is that situation, and is dropped. In a column without data (the weekday rush
 * hours) an absent cell really is a blind hour, and interpolation is the answer.
 *
 * `heldBack` are cells the backtest scored and found worse than the fallback
 * (backtest.ts `heldBackCells`). They are absent from the measured profile for
 * that reason, not for want of data, so they are dropped before anything else:
 * filled from their neighbours they would ship, labelled INTERPOLATED, in the
 * one place the backtest measured that the fallback does better.
 */
export function rejectConflicting(
  candidates: ReadonlyMap<string, number>,
  /** `${line}@${dir}|${column}` -> the model's own headway seconds, vouched or not. */
  reference: ReadonlyMap<string, number>,
  measuredColumns: ReadonlySet<number>,
  /** Columns with enough healthy days to fit a profile at all. */
  dataColumns: ReadonlySet<number> = new Set(),
  heldBack: ReadonlySet<string> = new Set(),
  tolerance: number = CONFLICT_TOLERANCE,
  cellVeto: number = CELL_VETO
): ConflictResult {
  const columnOf = (id: string) => Number(id.slice(id.lastIndexOf('|') + 1))
  const interpolated = new Map([...candidates].filter(([id]) => !heldBack.has(id)))
  const heldBackDropped = candidates.size - interpolated.size

  const deviations = new Map<number, number[]>()
  for (const [id, seconds] of interpolated) {
    const own = reference.get(id)
    if (own === undefined || own <= 0) continue
    const column = columnOf(id)
    let list = deviations.get(column)
    if (!list) deviations.set(column, list = [])
    list.push(Math.abs(Math.log(seconds / own)))
  }
  const median = new Map<number, number>()
  for (const [column, list] of deviations) {
    const sorted = [...list].sort((a, b) => a - b)
    median.set(column, sorted[Math.floor(sorted.length / 2)]!)
  }

  // Which span a column belongs to: the nearest measured hours either side.
  const spanOf = (column: number): string => {
    const dayType = columnDayType(column)
    const hour = columnHour(column)
    const base = dayType === 'WD' ? 0 : 24
    let lower = -1
    let upper = 24
    for (let h = 0; h < 24; h++) {
      if (!measuredColumns.has(base + h)) continue
      if (h < hour) lower = h
      else if (h > hour) {
        upper = h
        break
      }
    }
    return `${dayType}:${lower}:${upper}`
  }

  const failing = new Set<string>()
  for (const [column, value] of median) {
    if (value > tolerance) failing.add(spanOf(column))
  }
  const rejected = new Set<number>()
  for (const id of interpolated.keys()) {
    const column = columnOf(id)
    if (failing.has(spanOf(column))) rejected.add(column)
  }

  const accepted = new Map<string, number>()
  let vetoedCells = 0
  let sparseVetoed = 0
  for (const [id, seconds] of interpolated) {
    const column = columnOf(id)
    if (rejected.has(column)) continue
    const own = reference.get(id)
    if (own === undefined && dataColumns.has(column)) {
      sparseVetoed++
      continue
    }
    if (own !== undefined && own > 0 && Math.abs(Math.log(seconds / own)) > cellVeto) {
      vetoedCells++
      continue
    }
    accepted.set(id, seconds)
  }
  return { accepted, rejectedColumns: [...rejected].sort((a, b) => a - b), deviations: median, vetoedCells, sparseVetoed, heldBackDropped }
}
