/*
 * Station role as ONE number: b ∈ [0,1], the "business" weight. 0 is a pure
 * residential origin (people board in the morning, come back in the evening),
 * 1 a pure business destination (people arrive in the morning, board in the
 * evening). See docs/station-density.md "Station roles" and "Crowdsourced checks".
 */
export type DayBucket = 'WD' | 'SAT' | 'SUN'

/*
 * Distance decay: b = B0 · e^(−t/TAU), t = scheduled minutes to the core.
 * B0 0.85 puts Sudirman at ~85% arrivals in the morning (Sudirman Baru: 80–88% of
 * alighting before noon). TAU 25 min puts Kranji (~20 min out) mid-low and Bogor
 * (~60–75 min) near zero, matching the crowdsourced ordering.
 */
const B0 = 0.85
const TAU_MIN = 25
/** No path to the core (the LRT Jakarta island): treat as mildly residential. */
const UNKNOWN_B = 0.3

export function businessWeight(rideMin: number | undefined): number {
  if (rideMin === undefined) return UNKNOWN_B
  return B0 * Math.exp(-rideMin / TAU_MIN)
}

/*
 * Stations the decay can't explain, each with the evidence that it is different.
 * WE applies to SAT and SUN alike (the crowdsourced checks found them the same).
 */
export const ROLE_OVERRIDES: Record<string, { WD?: number, WE?: number }> = {
  // Weekday origin, weekend leisure destination: no morning peak and a 15–21 plateau at weekends.
  'KCI-BOO': { WE: 0.6 },
  // KCI lists it as an office arrival station, but its evening is as big as its morning.
  'KCI-TEB': { WD: 0.5, WE: 0.5 },
  // Interchange: transfers in both peaks; Lebaran transit record 201,617.
  'KCI-MRI': { WD: 0.5, WE: 0.5 },
  // Interchange: the Dukuh Atas integration area (KRL Sudirman, airport rail, LRT, TJ) feeds the MRT both ways.
  'MRTJ-DKA': { WD: 0.5, WE: 0.5 },
  // Interchange: every Tangerang-line rider bound for the loop changes here, in both peaks.
  'KCI-DU': { WD: 0.5, WE: 0.5 },
  // Shopping district: busy at weekends too (20,504 by 14:00 on Sun 4 Jan 2026).
  'KCI-THB': { WD: 0.6, WE: 0.6 },
  // Terminus + Kota Tua leisure; busiest at weekend evenings.
  'KCI-JAKK': { WD: 0.5, WE: 0.65 }
}

export function roleWeight(stationId: string, day: DayBucket, rideMin: number | undefined): number {
  const o = ROLE_OVERRIDES[stationId]
  const override = day === 'WD' ? o?.WD : o?.WE
  return override ?? businessWeight(rideMin)
}

/*
 * Share of a station's boardings before 13:00.
 * Weekday: Bogor boards ~55% before 13:00 (8 May 2026 release); business
 * stations board mostly in the evening. Linear in b between those ends.
 * Weekend: days run late (holiday KRL ≈ 26% before 13:00); 0.35 leaves room
 * for Bekasi-style morning outings, b nudges business stations later still.
 */
export function amShareFor(b: number, day: DayBucket): number {
  return day === 'WD' ? 0.6 - 0.45 * b : 0.35 - 0.1 * b
}

/*
 * Day volume relative to a weekday. The weekend spectrum: business ~40–45%, far
 * origins ~75–80% (crowdsourced checks, and KCI's own 41% for Sudirman on a
 * holiday Sunday). Holidays reach here as SUN.
 */
export function dayLevel(b: number, day: DayBucket): number {
  return day === 'WD' ? 1 : 0.8 - 0.4 * b
}

/*
 * How much earlier than the network average a station's morning boarding runs.
 * 30 min is roughly the average ride to the core; each hour farther out is an
 * hour earlier. Clamped: the network curve is already an average of real stations.
 */
export function amShiftHours(rideMin: number | undefined): number {
  if (rideMin === undefined) return 0
  return Math.min(1, Math.max(-0.5, (rideMin - 30) / 60))
}
