import { clampHeadway } from '../../../utils/headwayBounds'
import { columnDayType, columnHour, type FactorisedModel, lineDirOf } from './fit'

/*
 * The last-resort fallback: schedule headways times a per-column scale, capped.
 *
 * Where a column is vouched, the scale is how much longer the observed value is
 * than what the planner would otherwise use for the same stop (the median over
 * stops). Where it is not (weekday rush hours, overnight), the scale is
 * interpolated between the nearest vouched hours of the same day type, so the
 * curve across the day stays continuous instead of dropping back to the most
 * optimistic number exactly where there is no data.
 *
 * The cap exists because observed line-level headways SATURATE rather than
 * scaling with the schedule: at midday a schedule value of 120s or less reads
 * about 3.5x longer in the data, 450-900s reads about 1.1x. A flat multiplier
 * therefore overshoots exactly for the lines nobody observed (an integration
 * line at 514s came out at 28 minutes where comparable lines ran about 16).
 * The cap is the 90th percentile of the line-level headways measured in the
 * column. Held out line by line it beat the plain scalar on every tail
 * (p90 |log error| 0.58 against 0.71) and a fitted power law (0.64), with the
 * median unchanged. The runtime never lets it shorten a schedule value.
 */
export const MIN_CAP_LINES = 8
export const CAP_QUANTILE = 0.9

export const MIN_SCALE_RATIOS = 20

export interface ColumnScale {
  /** `WD:10`-style column id. */
  id: string
  scale: number
  /** Upper bound for the scaled value, seconds; undefined where too few lines were measured. */
  cap?: number
  /** True when computed from data, false when interpolated. */
  measured: boolean
}

/** What the planner would use for a key on a given day: per-stop value, else per-line. */
export type BaseLookup = (day: 'WD' | 'SAT' | 'SUN', key: string) => number | undefined

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]!
}

/** The mean of the directions' modelled headways at one stop, clamped like the runtime does. */
export function plannerValue(model: FactorisedModel, lineStop: string, column: number): number | undefined {
  const values: number[] = []
  for (const dir of ['F', 'R'] as const) {
    const key = `${lineStop}@${dir}`
    const profile = model.profile.get(`${lineDirOf(key)}|${column}`)
    const factor = model.factor.get(key)
    if (profile !== undefined && factor !== undefined) values.push(1 / (profile * factor))
  }
  if (values.length === 0) return undefined
  return clampHeadway(values.reduce((a, b) => a + b, 0) / values.length)
}

export function computeColumnScales(
  model: FactorisedModel,
  vouched: ReadonlySet<number>,
  base: BaseLookup
): ColumnScale[] {
  const lineStops = new Set<string>()
  for (const key of model.factor.keys()) lineStops.add(key.slice(0, key.lastIndexOf('@')))

  const measured = new Map<string, number>()
  const caps = new Map<string, number>()
  for (const column of vouched) {
    const dayType = columnDayType(column)
    const days = dayType === 'WD' ? (['WD'] as const) : (['SAT', 'SUN'] as const)
    const ratios: number[] = []
    for (const lineStop of lineStops) {
      const observed = plannerValue(model, lineStop, column)
      if (observed === undefined) continue
      const line = lineStop.slice(0, lineStop.indexOf('@'))
      for (const day of days) {
        const reference = base(day, lineStop) ?? base(day, line)
        if (reference !== undefined && reference > 0) ratios.push(observed / reference)
      }
    }
    if (ratios.length >= MIN_SCALE_RATIOS) measured.set(`${dayType}:${columnHour(column)}`, median(ratios))

    // Line-level headway: the mean of a line's directions at an average stop.
    const byLine = new Map<string, number[]>()
    for (const [id, perSecond] of model.profile) {
      const [lineDir, columnText] = id.split('|') as [string, string]
      if (Number(columnText) !== column) continue
      const line = lineDir.slice(0, lineDir.lastIndexOf('@'))
      byLine.set(line, [...(byLine.get(line) ?? []), 1 / perSecond])
    }
    const levels = [...byLine.values()].map(v => v.reduce((a, b) => a + b, 0) / v.length).sort((a, b) => a - b)
    if (levels.length >= MIN_CAP_LINES) {
      caps.set(`${dayType}:${columnHour(column)}`, levels[Math.floor(CAP_QUANTILE * (levels.length - 1))]!)
    }
  }

  const out: ColumnScale[] = []
  for (const dayType of ['WD', 'WE'] as const) {
    const known = [...Array(24).keys()]
      .filter(h => measured.has(`${dayType}:${h}`))
    if (known.length === 0) continue
    for (let hour = 0; hour < 24; hour++) {
      const id = `${dayType}:${hour}`
      const lower = [...known].reverse().find(h => h < hour)
      const upper = known.find(h => h > hour)
      // Same interpolation for the scale and the cap: between the nearest
      // measured hours, holding the end value past the first or last.
      const across = (table: ReadonlyMap<string, number>): number | undefined => {
        const direct = table.get(id)
        if (direct !== undefined) return direct
        const near = (h: number | undefined) => (h === undefined ? undefined : table.get(`${dayType}:${h}`))
        const a = near(lower)
        const b = near(upper)
        if (a === undefined) return b
        if (b === undefined) return a
        return a + ((b - a) * (hour - lower!)) / (upper! - lower!)
      }
      out.push({
        id,
        scale: across(measured)!,
        cap: across(caps),
        measured: measured.has(id)
      })
    }
  }
  return out
}
