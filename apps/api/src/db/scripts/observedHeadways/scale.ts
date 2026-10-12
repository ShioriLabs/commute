import { clampHeadway } from '../../../utils/headwayBounds'
import { columnDayType, columnHour, type FactorisedModel, lineDirOf } from './fit'

/*
 * The fallback for hours the model cannot speak to: schedule headways times a
 * per-column scale.
 *
 * Where a column is vouched, the scale is how much longer the observed value is
 * than what the planner would otherwise use for the same stop (the median over
 * stops). Where it is not (weekday rush hours, overnight), the scale is
 * interpolated between the nearest vouched hours of the same day type, so the
 * curve across the day stays continuous instead of dropping back to the most
 * optimistic number exactly where there is no data.
 */

export const MIN_SCALE_RATIOS = 20

export interface ColumnScale {
  /** `WD:10`-style column id. */
  id: string
  scale: number
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
  }

  const out: ColumnScale[] = []
  for (const dayType of ['WD', 'WE'] as const) {
    const known = [...Array(24).keys()]
      .filter(h => measured.has(`${dayType}:${h}`))
    if (known.length === 0) continue
    for (let hour = 0; hour < 24; hour++) {
      const id = `${dayType}:${hour}`
      const direct = measured.get(id)
      if (direct !== undefined) {
        out.push({ id, scale: direct, measured: true })
        continue
      }
      const lower = [...known].reverse().find(h => h < hour)
      const upper = known.find(h => h > hour)
      const at = (h: number) => measured.get(`${dayType}:${h}`)!
      let scale: number
      if (lower === undefined) scale = at(upper!)
      else if (upper === undefined) scale = at(lower)
      else scale = at(lower) + ((at(upper) - at(lower)) * (hour - lower)) / (upper - lower)
      out.push({ id, scale, measured: false })
    }
  }
  return out
}
