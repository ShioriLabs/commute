import { RIDER_CURVES } from '../../data/rider-curves'
import type { RidershipAnchor } from '../../data/ridership'
import { type Curve, reweightMorning, shiftAm, withAmShare } from './curves'
import { amShareFor, amShiftHours, type DayBucket, dayLevel, roleWeight } from './roles'

/** 0 Lengang, 1 Ramai, 2 Padat, 3 Sangat Padat. */
export type Level = 0 | 1 | 2 | 3

/*
 * The model's uncertainty for one hour: the level could be anywhere from min to
 * max. null means no estimate at all (no service, or too few trains to divide
 * by), which is never the same as Lengang.
 */
export type LevelRange = { min: Level, max: Level } | null

/*
 * Passengers per departing train, by operator. Same figures as the station
 * score's CAPACITY and LINE_CAPACITY (generateStationScoresSQL.ts); restated
 * here because that file is a script with side effects on import. Keep the
 * two in step. Levels are in riders, not shares of a train, so these only say
 * how much of a usual departure an unusual one is worth (LINE_CAPACITY).
 */
export const CAPACITY = { KCI: 2000, MRTJ: 1200, LRTJ: 270, LRTJBDB: 740 } as const

/*
 * Lines that don't run their operator's usual stock. 'A' is the airport line:
 * a 6-car KA Bandara set, ~300 a train. Without it every airport-line departure
 * at Duri, BNI City, Rawa Buaya and Batu Ceper would count as a 12-car KRL and
 * pull those stations towards Lengang. The generator uses it to turn departures
 * into capacity-equivalent ones.
 */
export const LINE_CAPACITY: Record<string, number> = { A: 300 }

/*
 * Boardings per departing train, in riders: below the first cut is Lengang,
 * then Ramai, then Padat, at or above the last Sangat Padat. An absolute count,
 * not a share of the train, because it is the people waiting on the platform
 * that a rider sees, and the spec's measured points only line up in this unit
 * (docs/station-density.md "Revised model": Manggarai at midday ~317 is still
 * twice Dukuh Atas BNI at its peak ~155). A 2-car LRT Jakarta set therefore
 * rarely reads Sangat Padat, which matches its platforms.
 * Tuned against density.calibration.test.ts.
 */
export const LEVEL_THRESHOLDS = [60, 120, 340] as const

/*
 * How far the real load may sit from the modelled one, as multipliers. The hour's
 * range is the level at load × lo to the level at load × hi. A station with a
 * published ridership anchor has its volume pinned, so only the curve and role
 * are guesses. MRT Jakarta's anchors don't say whether they count taps in or in
 * and out (ridership.ts header), so their top end also allows the 2x that
 * reading would add. A station estimated from its score inherits that score's
 * log-scale error too, which is easily 2× either way.
 */
export const UNCERTAINTY_BAND = {
  anchored: { lo: 0.75, hi: 1.33 },
  anchoredMetricUnstated: { lo: 0.75, hi: 2.66 },
  scored: { lo: 0.5, hi: 2 }
} as const

/** An hour needs at least this fraction of the station's peak departures to get a level. */
const MIN_SERVICE_FRACTION = 0.25

/*
 * ...and at least this many trains. One train is no basis for a ratio: it is
 * what put Rangkasbitung's 03h, a single first departure, on the board.
 */
const MIN_DEPARTURES = 2

/** Measured-demand log scale; must match generateStationScoresSQL.ts. */
const DEMAND_FLOOR = 500
const DEMAND_CEIL = 250_000

/** KCI's share of weekday boardings before 10:00, from its 2026 releases (JakLingko says 28.3%). */
const KCI_SHARE_BEFORE_10 = 0.35

export function boardingsPerDay(anchor: RidershipAnchor | undefined, score: number): number {
  if (anchor) return (anchor.gatePerDay ?? 0) / 2 + (anchor.transitPerDay ?? 0)
  const lo = Math.log(1 + DEMAND_FLOOR), hi = Math.log(1 + DEMAND_CEIL)
  return (Math.exp(lo + (score / 100) * (hi - lo)) - 1) / 2
}

export function levelOf(load: number): Level {
  let level = 0
  for (const cut of LEVEL_THRESHOLDS) {
    if (load >= cut) level++
  }
  return level as Level
}

export interface StationInput {
  stationId: string
  operator: keyof typeof CAPACITY
  anchor?: RidershipAnchor
  score: number
  rideMin?: number
  /** Per hour, in trains of the operator's usual stock (see LINE_CAPACITY). */
  departures: Record<DayBucket, number[]>
}

function baseCurve(operator: StationInput['operator']): Curve {
  // LRT Jabodebek has no JakLingko curve and borrows KCI's, corrected the same way.
  if (operator === 'KCI' || operator === 'LRTJBDB') return reweightMorning([...RIDER_CURVES.KCI], 10, KCI_SHARE_BEFORE_10)
  return [...RIDER_CURVES[operator]]
}

export function stationCurve(input: StationInput, day: DayBucket): Curve {
  const b = roleWeight(input.stationId, day, input.rideMin)
  const shifted = day === 'WD' ? shiftAm(baseCurve(input.operator), amShiftHours(input.rideMin)) : baseCurve(input.operator)
  return withAmShare(shifted, amShareFor(b, day))
}

function bandFor(input: StationInput) {
  if (!input.anchor) return UNCERTAINTY_BAND.scored
  return input.operator === 'MRTJ' ? UNCERTAINTY_BAND.anchoredMetricUnstated : UNCERTAINTY_BAND.anchored
}

export function hourlyLevels(input: StationInput, day: DayBucket): LevelRange[] {
  const deps = input.departures[day]
  const peak = Math.max(...deps)
  if (peak === 0) return new Array(24).fill(null)
  const b = roleWeight(input.stationId, day, input.rideMin)
  const riders = boardingsPerDay(input.anchor, input.score) * dayLevel(b, day)
  const band = bandFor(input)
  return stationCurve(input, day).map((share, h): LevelRange => {
    const n = deps[h] ?? 0
    if (n < peak * MIN_SERVICE_FRACTION || n < MIN_DEPARTURES) return null
    const load = riders * share / n
    return { min: levelOf(load * band.lo), max: levelOf(load * band.hi) }
  })
}
