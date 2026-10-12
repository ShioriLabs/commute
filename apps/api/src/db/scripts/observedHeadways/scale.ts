import { clampHeadway } from '../../../utils/headwayBounds'
import { columnDayType, columnHour, type FactorisedModel, lineDirOf } from './fit'

/*
 * The last-resort fallback: schedule headways times a per-column scale, capped.
 *
 * The scale is how much longer the modelled value is than what the planner
 * would otherwise use for the same stop (the median over ~900 stops). It is
 * measured for EVERY column the model has usable cells for, vouched or not:
 * a median over hundreds of stops averages out the per-stop noise that keeps
 * thin hours (night) from validating. It is the same quantity the backtest's
 * `gtfsScaled` baseline estimates (a per-column median ratio to the schedule),
 * though computed here from the shipped model against the planner's base values
 * rather than from pooled key-hour estimates against per-key schedule values. Only the columns with no
 * usable data (weekday rush hours) are interpolated, between the nearest
 * measured hours of the same day type, so the curve across the day stays
 * continuous instead of dropping back to the most optimistic number there.
 *
 * The CAP is the exception: it is a 90th percentile over only 8-15 lines, which
 * is noisy where a scale (a median over hundreds of stops) is not, and measured
 * on unvalidated columns it stepped by 2x between neighbouring hours (a 514s line
 * read 22 minutes at 09:00 and 13 at 10:00). Caps are therefore taken only from
 * the columns that ship a measured profile, and interpolated across the rest.
 *
 * Two scales, because the schedule has two kinds of number: the per-stop one
 * pools both directions' trips, the directional one does not (~1.17x longer on
 * the same stops). Each scale is measured against the kind it multiplies.
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
export const MIN_SCALE_RATIOS_DIR = 20

export const MIN_SCALE_RATIOS = 20

export interface ColumnScale {
  /** `WD:10`-style column id. */
  id: string
  scale: number
  /** Scale for directional schedule values, measured against those. */
  scaleDir?: number
  /** Upper bound for the scaled value, seconds; undefined where too few lines were measured. */
  cap?: number
  /** True when computed from data, false when interpolated. */
  measured: boolean
}

/** What the planner would use for a key on a given day: per-stop value, else per-line. */
export type BaseLookup = (day: 'WD' | 'SAT' | 'SUN', key: string) => number | undefined

/** The schedule's directional value for `line@stop@dir`, if it has one. */
export type DirBaseLookup = (key: string) => number | undefined

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

/** Columns the model has at least one profile cell for: the ones with usable data. */
export function columnsWithData(model: FactorisedModel): number[] {
  const columns = new Set<number>()
  for (const id of model.profile.keys()) columns.add(Number(id.slice(id.lastIndexOf('|') + 1)))
  return [...columns].sort((a, b) => a - b)
}

export function computeColumnScales(
  model: FactorisedModel,
  base: BaseLookup,
  baseDir: DirBaseLookup,
  /** Columns that ship a measured profile; the only ones a cap is measured from. */
  capColumns: ReadonlySet<number>
): ColumnScale[] {
  const lineStops = new Set<string>()
  for (const key of model.factor.keys()) lineStops.add(key.slice(0, key.lastIndexOf('@')))

  const measured = new Map<string, number>()
  const measuredDir = new Map<string, number>()
  const caps = new Map<string, number>()
  for (const column of columnsWithData(model)) {
    const dayType = columnDayType(column)
    const id = `${dayType}:${columnHour(column)}`
    const days = dayType === 'WD' ? (['WD'] as const) : (['SAT', 'SUN'] as const)

    const ratios: number[] = []
    const ratiosDir: number[] = []
    for (const lineStop of lineStops) {
      const line = lineStop.slice(0, lineStop.indexOf('@'))
      const observed = plannerValue(model, lineStop, column)
      if (observed !== undefined) {
        for (const day of days) {
          const reference = base(day, lineStop) ?? base(day, line)
          if (reference !== undefined && reference > 0) ratios.push(observed / reference)
        }
      }
      for (const dir of ['F', 'R'] as const) {
        const key = `${lineStop}@${dir}`
        const profile = model.profile.get(`${lineDirOf(key)}|${column}`)
        const factor = model.factor.get(key)
        const reference = baseDir(key)
        if (profile === undefined || factor === undefined || reference === undefined || reference <= 0) continue
        ratiosDir.push(clampHeadway(1 / (profile * factor)) / reference)
      }
    }
    if (ratios.length >= MIN_SCALE_RATIOS) measured.set(id, median(ratios))
    if (ratiosDir.length >= MIN_SCALE_RATIOS_DIR) measuredDir.set(id, median(ratiosDir))

    if (!capColumns.has(column)) continue

    // Line-level headway: the mean of a line's directions at an average stop.
    const byLine = new Map<string, number[]>()
    for (const [pid, perSecond] of model.profile) {
      const [lineDir, columnText] = pid.split('|') as [string, string]
      if (Number(columnText) !== column) continue
      const line = lineDir.slice(0, lineDir.lastIndexOf('@'))
      byLine.set(line, [...(byLine.get(line) ?? []), 1 / perSecond])
    }
    const levels = [...byLine.values()].map(v => v.reduce((a, b) => a + b, 0) / v.length).sort((a, b) => a - b)
    if (levels.length >= MIN_CAP_LINES) {
      // Clamped like every other shipped headway, so the cap and the values it
      // bounds share a base (it used to reach 5.5k s against a 3.6k s bound).
      caps.set(id, clampHeadway(levels[Math.floor(CAP_QUANTILE * (levels.length - 1))]!))
    }
  }

  /**
   * Value of a measured table at (dayType, hour): the measured value, else a
   * linear blend of the nearest measured hours of THAT table, holding the end
   * value past the first or last. Each table has its own measured hours (the
   * scales come from every column with data, the caps only from vouched ones).
   */
  const across = (table: ReadonlyMap<string, number>, dayType: string, hour: number): number | undefined => {
    const direct = table.get(`${dayType}:${hour}`)
    if (direct !== undefined) return direct
    const known = [...Array(24).keys()].filter(h => table.has(`${dayType}:${h}`))
    const lower = [...known].reverse().find(h => h < hour)
    const upper = known.find(h => h > hour)
    if (lower === undefined && upper === undefined) return undefined
    const a = lower === undefined ? undefined : table.get(`${dayType}:${lower}`)
    const b = upper === undefined ? undefined : table.get(`${dayType}:${upper}`)
    if (a === undefined) return b
    if (b === undefined) return a
    return a + ((b - a) * (hour - lower!)) / (upper! - lower!)
  }

  const out: ColumnScale[] = []
  for (const dayType of ['WD', 'WE'] as const) {
    // A day type with no measured scale at all has nothing to ship.
    if (![...Array(24).keys()].some(h => measured.has(`${dayType}:${h}`))) continue
    for (let hour = 0; hour < 24; hour++) {
      const id = `${dayType}:${hour}`
      out.push({
        id,
        scale: across(measured, dayType, hour)!,
        scaleDir: across(measuredDir, dayType, hour),
        cap: across(caps, dayType, hour),
        measured: measured.has(id)
      })
    }
  }
  return out
}
