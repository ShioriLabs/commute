import { RIDERSHIP_BY_STATION_ID, type RidershipAnchor } from '../../data/ridership'
import { RELEASE_COUNTS_BY_STATION_ID, RELEASE_TRANSIT_BY_STATION_ID, type ReleaseCount, type ReleaseTransit } from '../../data/release-counts'
import { boardingsPerDay, type CAPACITY, type VolumeSource } from './model'

/*
 * How many riders board each station on a normal weekday, and how much to
 * trust that number. Best source first:
 *
 * 1. An annual anchor (ridership.ts), as published.
 * 2. A press-release count (release-counts.ts), scaled from its cut-off to a day.
 * 3. Otherwise the station score, inverted. For KCI that inversion is rescaled
 *    so the whole network adds up to KCI's own daily total. The unanchored score
 *    is a capped service-and-structure estimate, not demand, and inverted as-is
 *    it put Tebet at ~4.6k a day against ~19.4k arriving by 13:00. The score
 *    still decides each station's share; the total decides the level.
 *
 * Transfers from a release (RELEASE_TRANSIT) are added last, on top of
 * whichever of those applied: they aren't gate traffic, so they sit outside
 * the network total and the ceiling.
 */

/*
 * Share of a station's day that a release's morning count covers.
 * Origins: Bekasi's 24.8k by 11:00 is ~0.80 of its anchored ~30.2k boardings,
 * Bogor's ~30k by 13:00 ~0.55–0.59 (it is also a leisure destination). Boarding at
 * origins barely moves after 10:00, so the 11:00 and 13:00 cut-offs share a figure.
 * Destinations: Sudirman Baru took 80–88% of its day's alighting before noon,
 * and Gondangdia and Juanda were within ~3% of their 13:00 count by 11:00.
 */
export const ORIGIN_SHARE_BEFORE_CUTOFF = 0.65
export const DESTINATION_SHARE_BEFORE_CUTOFF = 0.85

/*
 * An 08:00 count is mid-peak, so it covers far less of an origin's day. The
 * 21 Sep 2026 release (Monday, normal schedule) counted anchored stations too:
 * Citayam 12,115 of ~31.0k (0.39), Bekasi 11,248 of ~30.2k (0.37). Bogor's 0.26
 * is left out, for the same reason as above: its afternoon is leisure traffic.
 */
export const ORIGIN_SHARE_BEFORE_08 = 0.38

/*
 * KRL riders on a weekday: the median of KCI's daily series, Jan–May 2026
 * (docs/station-density.md "Day types"). Riders are gate entries, so this is
 * compared against gate boardings only; transfers are on top.
 */
export const KCI_WEEKDAY_RIDERS = 1_080_000

/*
 * Ceiling for a station KCI has never ranked. Its busiest-by-gate top five
 * (Jan–Nov 2025, ridership.ts) ends with Bekasi at 60,407 taps a day, so every
 * station missing from that list taps fewer, i.e. boards under half of that.
 * Without it the score inversion, scaled up, put Jakarta Kota at ~119k a day,
 * above Bogor, the network's busiest gate station.
 */
export const UNRANKED_MAX_GATE_BOARDINGS = 60_407 / 2

export interface Volume { boardings: number, source: VolumeSource }

export interface VolumeStation {
  id: string
  operator: keyof typeof CAPACITY
  score: number
  /** Served only by the airport line, which isn't in KCI's KRL total. */
  airportOnly: boolean
}

export function releaseBoardings(r: ReleaseCount): number {
  if (r.kind === 'alighting') return r.count / DESTINATION_SHARE_BEFORE_CUTOFF
  return r.count / (r.cutoffHour === 8 ? ORIGIN_SHARE_BEFORE_08 : ORIGIN_SHARE_BEFORE_CUTOFF)
}

export function resolveVolumes(
  stations: VolumeStation[],
  anchors: ReadonlyMap<string, RidershipAnchor> = RIDERSHIP_BY_STATION_ID,
  releases: ReadonlyMap<string, ReleaseCount> = RELEASE_COUNTS_BY_STATION_ID,
  transits: ReadonlyMap<string, ReleaseTransit> = RELEASE_TRANSIT_BY_STATION_ID
): Map<string, Volume> {
  const out = new Map<string, Volume>()
  const scaled: VolumeStation[] = []
  let fixedGate = 0
  for (const s of stations) {
    const anchor = anchors.get(s.id)
    const release = releases.get(s.id)
    const inKrlTotal = s.operator === 'KCI' && !s.airportOnly
    if (anchor) {
      // MRT Jakarta doesn't say whether its figures count taps in or in and out.
      out.set(s.id, { boardings: boardingsPerDay(anchor, s.score), source: s.operator === 'MRTJ' ? 'anchoredMetricUnstated' : 'anchored' })
      if (inKrlTotal) fixedGate += (anchor.gatePerDay ?? 0) / 2
    } else if (release) {
      out.set(s.id, { boardings: releaseBoardings(release), source: 'release' })
      if (inKrlTotal) fixedGate += releaseBoardings(release)
    } else {
      out.set(s.id, { boardings: boardingsPerDay(undefined, s.score), source: 'scored' })
      if (inKrlTotal) scaled.push(s)
    }
  }

  /*
   * Share what the anchors leave of the network total out by score, capping any
   * station that would pass UNRANKED_MAX_GATE_BOARDINGS and handing its excess
   * back to the rest, until nobody is over. Only ever scale up: a factor below 1
   * would mean the anchors alone exceed the network, which says the anchors are
   * stale, not that small stations are empty.
   */
  let pool = scaled
  let residual = KCI_WEEKDAY_RIDERS - fixedGate
  for (;;) {
    const weights = pool.reduce((sum, s) => sum + out.get(s.id)!.boardings, 0)
    const factor = weights > 0 && residual > weights ? residual / weights : 1
    const over = pool.filter(s => out.get(s.id)!.boardings * factor > UNRANKED_MAX_GATE_BOARDINGS)
    if (!over.length) {
      for (const s of pool) out.get(s.id)!.boardings *= factor
      break
    }
    for (const s of over) {
      out.get(s.id)!.boardings = UNRANKED_MAX_GATE_BOARDINGS
      residual -= UNRANKED_MAX_GATE_BOARDINGS
    }
    pool = pool.filter(s => !over.includes(s))
  }

  for (const s of stations) {
    const transit = transits.get(s.id)
    // An anchor's own transfer figure, where it has one, already counted them.
    if (transit && anchors.get(s.id)?.transitPerDay === undefined) out.get(s.id)!.boardings += transit.transitPerDay
  }
  return out
}
