import { OPERATORS } from '@commute/constants'
import type { RouteLeg } from '@commute/tsundere'
import { AIRPORT_TERMINUS_CODE } from 'operators/kci/airportFares'
import { APT_CGK_LINE } from 'operators/kci/lines'

const AIRPORT_STATION_ID = `${OPERATORS.KCI.code}-${AIRPORT_TERMINUS_CODE}`
const AIRPORT_LINES: ReadonlySet<string> = new Set([APT_CGK_LINE.lineCode])

/*
 * KA Bandara is in the graph but only offered for journeys that start or end at
 * the airport: KCI-BST itself, or any Kalayang stop (the terminals reach the
 * train through it). Everywhere else it would win city trips on speed alone —
 * Manggarai -> Duri at Rp10.000 over a Rp3.000 KRL — which nobody asking for a
 * commute wants, so it is excluded before the search rather than ranked below.
 */
function touchesAirport(stationId: string): boolean {
  return stationId === AIRPORT_STATION_ID || stationId.startsWith(`${OPERATORS.APCGK.code}-`)
}

export function airportExclusion(fromId: string, toId: string): ReadonlySet<string> {
  return touchesAirport(fromId) || touchesAirport(toId) ? new Set() : AIRPORT_LINES
}

/*
 * Only airport-bound pairs are priced (see operators/kci/airportFares.ts), so a
 * journey that rides line A without BST at either end of that ride would come
 * back unpriced. The exclusion above keeps A out of city trips; this catches an
 * airport trip that boards it at Manggarai and gets off at Duri to change.
 */
export function ridesAirportPairsOnly(legs: readonly RouteLeg[]): boolean {
  return legs.every(leg => leg.type !== 'RIDE'
    || !AIRPORT_LINES.has(leg.lineCode)
    || leg.fromStationId === AIRPORT_STATION_ID
    || leg.toStationId === AIRPORT_STATION_ID)
}

/** Both exclusions as one set, for callers that already exclude something. */
export function withAirportExclusion(fromId: string, toId: string, excluded?: ReadonlySet<string>): ReadonlySet<string> {
  const airport = airportExclusion(fromId, toId)
  if (!excluded || excluded.size === 0) return airport
  if (airport.size === 0) return excluded
  return new Set([...excluded, ...airport])
}
