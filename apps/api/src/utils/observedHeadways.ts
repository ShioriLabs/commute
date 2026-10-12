import { LINE_TERMINI } from '../db/data/headways'
import {
  OBSERVED_GTFS_CAP_S,
  OBSERVED_GTFS_SCALE,
  OBSERVED_GTFS_SCALE_DIR,
  OBSERVED_PROFILE_INTERP_S,
  OBSERVED_PROFILE_S,
  OBSERVED_STOP_FACTOR
} from '../db/data/headways.observed'
import type { ServiceDay } from '../db/data/service-hours'
import { clampHeadway } from './headwayBounds'
import { baseHeadways } from './headways'
import { memoize } from './memo'

/*
 * Observed TransJakarta headways, applied over the schedule-derived ones.
 *
 * The model is generated (db/scripts/fitObservedHeadways.ts, `pnpm --filter api
 * fit:headways`) and this module reads four exports of it and nothing else, so
 * refitting is "regenerate the file and deploy": no logic here knows how the
 * values were made, including how the gaps were filled.
 *
 *   OBSERVED_PROFILE_S         headway at an average stop of a line-direction,
 *                              per day type and hour. ABSENT where the backtest
 *                              did not vouch for the column.
 *   OBSERVED_PROFILE_INTERP_S  the same, interpolated across the hours that are
 *                              absent above. Never overlaps it.
 *   OBSERVED_STOP_FACTOR       how much more or less often a stop is served than
 *                              that average. ABSENT for stops the method barely sees.
 *   OBSERVED_GTFS_SCALE        the last resort: schedule value times this, so the
 *                              curve across a day stays continuous instead of
 *                              reverting to the schedule's most optimistic number
 *                              at the busiest hours.
 *   OBSERVED_GTFS_SCALE_DIR    the same for the schedule's DIRECTIONAL values, which
 *                              run longer than the pooled per-stop ones, so each
 *                              scale is measured against what it multiplies.
 *   OBSERVED_GTFS_CAP_S        ceiling for that scaled value per column: observed
 *                              headways saturate, so a multiplier alone overshoots
 *                              for lines whose schedule value is already long.
 *
 * Lookup order for a row: measured profile, interpolated profile, scaled
 * schedule, schedule. The basis reported for each is OBSERVED, INTERPOLATED,
 * SCALED, SCHEDULE.
 *
 * Only TransJakarta keys are touched; rail lines are never in the overlay and
 * keep their schedule values.
 */

export type Direction = 'F' | 'R'
export type DayType = 'WD' | 'WE'
export type ObservedBasis = 'OBSERVED' | 'INTERPOLATED' | 'SCALED' | 'SCHEDULE'

/** A modelled headway and whether it was interpolated rather than measured. */
export interface Observed {
  seconds: number
  interpolated: boolean
}

/** SAT and SUN read the pooled weekend model; a public holiday already arrives as SUN. */
export const dayTypeOf = (day: ServiceDay): DayType => (day === 'SAT' || day === 'SUN' ? 'WE' : 'WD')

const columnId = (day: ServiceDay, hour: number) => `${dayTypeOf(day)}:${hour}`

/** TJ corridors only: LINE_TERMINI is generated from the TJ topology. */
const isTjLine = (lineCode: string) => LINE_TERMINI[lineCode] !== undefined

const lineOf = (key: string) => key.slice(0, key.indexOf('@'))

// ── indices, built once per isolate ───────────────────────────────────────────
interface StopDirs { lineDir: string, factor: number }
interface Index {
  /** `line@stop` -> its observed directions. */
  stops: Map<string, StopDirs[]>
  /** `WD:10` -> `line@dir` -> profile seconds, measured and interpolated together. */
  profiles: Map<string, Map<string, Observed>>
  /** `WD:10` -> line -> the line-directions that have a profile there. */
  lines: Map<string, Map<string, string[]>>
}

let index: Index | undefined
function getIndex(): Index {
  if (index) return index
  const stops = new Map<string, StopDirs[]>()
  for (const [key, factor] of Object.entries(OBSERVED_STOP_FACTOR)) {
    const at = key.lastIndexOf('@')
    const lineStop = key.slice(0, at)
    const dir = key.slice(at + 1)
    const list = stops.get(lineStop) ?? []
    list.push({ lineDir: `${lineOf(key)}@${dir}`, factor })
    stops.set(lineStop, list)
  }
  const profiles = new Map<string, Map<string, Observed>>()
  const lines = new Map<string, Map<string, string[]>>()
  const add = (key: string, seconds: number, interpolated: boolean) => {
    // `${dayType}:${hour}:${line}@${dir}`
    const first = key.indexOf(':')
    const second = key.indexOf(':', first + 1)
    const column = key.slice(0, second)
    const lineDir = key.slice(second + 1)
    let byLineDir = profiles.get(column)
    if (!byLineDir) profiles.set(column, byLineDir = new Map())
    // A measured cell always wins; the generator never emits both, but a
    // hand-edited file should not be able to make an estimate beat a measurement.
    if (interpolated && byLineDir.has(lineDir)) return
    byLineDir.set(lineDir, { seconds, interpolated })
    let byLine = lines.get(column)
    if (!byLine) lines.set(column, byLine = new Map())
    const line = lineOf(lineDir)
    const known = byLine.get(line) ?? []
    if (!known.includes(lineDir)) byLine.set(line, [...known, lineDir])
  }
  for (const [key, seconds] of Object.entries(OBSERVED_PROFILE_S)) add(key, seconds, false)
  for (const [key, seconds] of Object.entries(OBSERVED_PROFILE_INTERP_S)) add(key, seconds, true)
  index = { stops, profiles, lines }
  return index
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length

/** The observed headway of one direction at one stop, or undefined where the model has none. */
export function observedDirHeadway(
  lineCode: string,
  stationId: string,
  dir: Direction,
  day: ServiceDay,
  hour: number
): Observed | undefined {
  const factor = OBSERVED_STOP_FACTOR[`${lineCode}@${stationId}@${dir}`]
  const profile = getIndex().profiles.get(columnId(day, hour))?.get(`${lineCode}@${dir}`)
  if (factor === undefined || profile === undefined) return undefined
  return { seconds: clampHeadway(profile.seconds / factor), interpolated: profile.interpolated }
}

/**
 * The observed headway at a stop with no direction known: the mean of the
 * directions the model has. A rider has not chosen a destination yet, and the
 * schedule's own per-stop figure pools both directions, which reads optimistic.
 */
export function observedStopHeadway(lineCode: string, stationId: string, day: ServiceDay, hour: number): Observed | undefined {
  const idx = getIndex()
  const dirs = idx.stops.get(`${lineCode}@${stationId}`)
  const profiles = idx.profiles.get(columnId(day, hour))
  if (!dirs || !profiles) return undefined
  const found = dirs
    .map(({ lineDir, factor }) => {
      const profile = profiles.get(lineDir)
      return profile === undefined ? undefined : { seconds: profile.seconds / factor, interpolated: profile.interpolated }
    })
    .filter((v): v is Observed => v !== undefined)
  if (found.length === 0) return undefined
  return { seconds: clampHeadway(mean(found.map(f => f.seconds))), interpolated: found.some(f => f.interpolated) }
}

/** The observed headway of a line at an average stop, mean over its directions. */
export function observedLineHeadway(lineCode: string, day: ServiceDay, hour: number): Observed | undefined {
  const idx = getIndex()
  const lineDirs = idx.lines.get(columnId(day, hour))?.get(lineCode)
  const profiles = idx.profiles.get(columnId(day, hour))
  if (!lineDirs || !profiles) return undefined
  const found = lineDirs.map(ld => profiles.get(ld)!)
  return { seconds: clampHeadway(mean(found.map(f => f.seconds))), interpolated: found.some(f => f.interpolated) }
}

/**
 * The observed headway of one direction of a line at an average stop: the
 * profile with no stop factor. What a stop the fit gave no factor (an origin
 * terminal, a halte the sampling barely sees) is read as: the line-direction's
 * own level, rather than the schedule scaled by a global multiplier.
 */
export function observedLineDirHeadway(lineCode: string, dir: Direction, day: ServiceDay, hour: number): Observed | undefined {
  const profile = getIndex().profiles.get(columnId(day, hour))?.get(`${lineCode}@${dir}`)
  if (profile === undefined) return undefined
  return { seconds: clampHeadway(profile.seconds), interpolated: profile.interpolated }
}

/**
 * The schedule value scaled to this hour, or undefined where there is no scale.
 *
 * `tj` says the line is a TransJakarta one. It defaults to "is a corridor in
 * the routing topology", which is what the planner map can know from a bare
 * line code; the station endpoint knows the operator and passes it, so the
 * integration and feeder lines that never route (and so were never observed)
 * move with the corridors beside them on a halte card instead of staying at
 * the schedule's optimistic number.
 *
 * `directional` says the schedule value is one of the per-direction ones, which
 * the pooled scale was not measured against.
 */
export function scaledHeadway(
  scheduleS: number,
  lineCode: string,
  day: ServiceDay,
  hour: number,
  tj: boolean = isTjLine(lineCode),
  directional = false
): number | undefined {
  const column = columnId(day, hour)
  const scale = (directional ? OBSERVED_GTFS_SCALE_DIR[column] : undefined) ?? OBSERVED_GTFS_SCALE[column]
  if (scale === undefined || !tj) return undefined
  const cap = OBSERVED_GTFS_CAP_S[column]
  const scaled = cap === undefined ? scheduleS * scale : Math.min(scheduleS * scale, cap)
  // Scaling only ever lengthens a wait: a line the schedule already calls
  // infrequent is not made to look better than its own schedule by the cap.
  return clampHeadway(Math.max(scheduleS, scaled))
}

// ── the planner's map ─────────────────────────────────────────────────────────
const plannerCache = new Map<string, Map<string, number>>()

/**
 * The flat `line` / `line@stop` -> seconds map the planner reads, for a day and
 * hour. With `enabled` false it is exactly the schedule map, which is the kill
 * switch's whole effect.
 *
 * Built lazily per (day, hour) and kept for the isolate's life: at most 3 x 24
 * maps of ~1.4k entries.
 */
export function plannerHeadways(day: ServiceDay, hour: number, enabled: boolean): Map<string, number> {
  const base = baseHeadways(day)
  if (!enabled) return base

  return memoize(plannerCache, `${day}:${hour}`, () => {
    const out = new Map<string, number>()
    for (const [key, seconds] of base) {
      // A per-line key is the bare line code; a per-stop key is `line@station`.
      const lineCode = key.includes('@') ? lineOf(key) : key
      out.set(key, scaledHeadway(seconds, lineCode, day, hour) ?? seconds)
    }

    const idx = getIndex()
    const column = columnId(day, hour)
    for (const line of idx.lines.get(column)?.keys() ?? []) {
      const observed = observedLineHeadway(line, day, hour)
      if (observed !== undefined) out.set(line, observed.seconds)
    }
    for (const lineStop of idx.stops.keys()) {
      const observed = observedStopHeadway(lineOf(lineStop), lineStop.slice(lineStop.indexOf('@') + 1), day, hour)
      if (observed !== undefined) out.set(lineStop, observed.seconds)
    }
    // A stop of an observed corridor the factor table does not cover takes its
    // line's observed level, not the scaled schedule: the fit drops origin
    // terminals and barely-seen haltes as detection artefacts, and the scaled
    // schedule is the most pessimistic thing it could then give them.
    //
    // Two limits, both of which the first version of this lacked. It applies
    // only to a stop with NO factor (a stop that has one but no profile at this
    // hour keeps its scaled value, the same rule the endpoint uses), and never
    // to a stop the schedule itself calls rarer than its line: a branch served
    // by one variant is not made to look like the trunk (12@TJ-H00261S: 3600s in
    // the schedule, 982s at line level).
    for (const [key, scheduleS] of base) {
      if (!key.includes('@') || idx.stops.has(key)) continue
      const line = lineOf(key)
      if (!isTjLine(line)) continue
      const level = observedLineHeadway(line, day, hour)
      if (level !== undefined && level.seconds >= scheduleS) out.set(key, level.seconds)
    }
    return out
  })
}

// ── one row of the station endpoint ───────────────────────────────────────────
export type RowKind = 'dir' | 'stop' | 'line'

export interface ResolveInput {
  /** The schedule value for this row and day; null for a line that does not run. */
  nominalS: number | null
  kind: RowKind
  lineCode: string
  stationId: string
  dir?: Direction
  day: ServiceDay
  hour: number
  enabled: boolean
  /**
   * Whether the row's operator is TransJakarta. Omitted: inferred from the line
   * code being a routed corridor. A line that is TJ but not routed has no
   * profile of its own, so it can only ever be SCALED.
   */
  tj?: boolean
}

/**
 * What a row should say for an hour: the measured value where the model has one
 * for exactly this row, else the line-direction's profile interpolated from its
 * neighbouring hours, else the schedule value scaled to the hour, else the
 * schedule value untouched.
 */
export function resolveHeadway(input: ResolveInput): { headwayS: number | null, basis: ObservedBasis } {
  const { nominalS, kind, lineCode, stationId, dir, day, hour, enabled } = input
  const tj = input.tj ?? isTjLine(lineCode)
  if (!enabled || nominalS === null || !tj) return { headwayS: nominalS, basis: 'SCHEDULE' }

  let observed: Observed | undefined
  if (kind === 'dir' && dir) observed = observedDirHeadway(lineCode, stationId, dir, day, hour)
  else if (kind === 'stop') observed = observedStopHeadway(lineCode, stationId, day, hour)
  else observed = observedLineHeadway(lineCode, day, hour)

  // No stop factor for this stop on a corridor that was observed: the line's own
  // level at this hour (factor 1), before falling to the scaled schedule. Only
  // where that is NOT shorter than the schedule says this stop is: the fit drops
  // stops for being rare as well as for being artefacts, and a branch halte the
  // schedule puts at an hour must not be priced as the trunk.
  if (observed === undefined && isTjLine(lineCode) && kind !== 'line') {
    const hasFactor = kind === 'dir' && dir
      ? OBSERVED_STOP_FACTOR[`${lineCode}@${stationId}@${dir}`] !== undefined
      : getIndex().stops.has(`${lineCode}@${stationId}`)
    if (!hasFactor) {
      const level = kind === 'dir' && dir
        ? observedLineDirHeadway(lineCode, dir, day, hour)
        : observedLineHeadway(lineCode, day, hour)
      if (level !== undefined && level.seconds >= nominalS) observed = level
    }
  }
  if (observed !== undefined) {
    return { headwayS: observed.seconds, basis: observed.interpolated ? 'INTERPOLATED' : 'OBSERVED' }
  }

  const scaled = scaledHeadway(nominalS, lineCode, day, hour, tj, kind === 'dir')
  if (scaled !== undefined) return { headwayS: scaled, basis: 'SCALED' }
  return { headwayS: nominalS, basis: 'SCHEDULE' }
}
