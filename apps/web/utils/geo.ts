import type { Station } from 'models/stations'
import type { JoinedStation } from './directional-stations'
import { joinDirectionalStations } from './directional-stations'

const EARTH_RADIUS_M = 6_371_000

/** How far out a station still counts as "terdekat". Beyond this the answer is
 * useless: at Bogor the next station up the line is 7.2 km away. */
export const NEARBY_RADIUS_M = 2000

/** Cards in the nearby rail, matching the other search-sheet rails. */
export const NEARBY_LIMIT = 5

/** Radius that counts as being at a station. Wide enough for a sprawling
 * complex like Manggarai, tight enough not to claim the next station over. */
export const HERE_RADIUS_M = 400

/** A fix vaguer than this cannot say which station you are in, so we don't
 * guess. Underground platforms hit this constantly. */
export const HERE_MAX_ACCURACY_M = 400

/** How long a stored fix may seed the home reorder before it's ignored. */
export const FIX_TTL_MS = 30 * 60 * 1000

export interface Fix {
  lat: number
  lng: number
  /** Radius of the accuracy circle in metres, from `GeolocationCoordinates`. */
  accuracy: number
  /** Epoch millis the fix was taken. */
  at: number
}

export interface NearbyStation {
  group: JoinedStation
  distanceM: number
}

/** A station we can actually place on the map. */
type LocatedStation = Station & { latitude: number, longitude: number }

/*
 * Whether a fix is recent enough to act on. Applied once in the location
 * context rather than at each call site — the two features previously
 * disagreed about staleness, and the rail happily presented an hours-old fix
 * as the user's current position.
 *
 * A future-dated fix (clock skew across a suspend/resume) counts as fresh;
 * throwing away a good reading over a jumpy clock helps nobody.
 */
export function isFixFresh(fix: Fix | null, now: number = Date.now()): boolean {
  if (!fix) return false
  return now - fix.at <= FIX_TTL_MS
}

const toRad = (deg: number): number => (deg * Math.PI) / 180

const hasCoordinates = (station: Station): station is LocatedStation =>
  station.latitude !== null && station.longitude !== null

/*
 * Great-circle distance between two lat/lng points, in metres.
 *
 * Deliberately duplicated from apps/api/src/utils/geo.ts rather than shared:
 * the web app should not reach into API internals, and a distance function is
 * not a constant, so @commute/constants is the wrong home for it.
 */
export function haversineMeters(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number
): number {
  const dLat = toRad(bLat - aLat)
  const dLng = toRad(bLng - aLng)
  const lat1 = toRad(aLat)
  const lat2 = toRad(bLat)
  const h
    = Math.sin(dLat / 2) ** 2
      + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)))
}

/*
 * The stations closest to a fix, nearest first, for the search sheet's rail.
 *
 * Directional halte pairs are folded with joinDirectionalStations so one
 * physical stop takes one card, and the fold happens BEFORE the limit is
 * applied — otherwise a single split halte would eat two of the five slots.
 * A group's distance is that of its nearest side.
 *
 * Note the group's `primary` is the lowest-code member, not necessarily the
 * nearest one. That's intentional: it keeps the station URL stable and matches
 * how search results already link these.
 */
export function rankNearby(stations: Station[], fix: Fix): NearbyStation[] {
  const eligible = stations
    .filter(station => station.regionCode === 'CGK' && station.searchable)
    .filter(hasCoordinates)

  const distances = new Map<string, number>()
  for (const station of eligible) {
    distances.set(station.id, haversineMeters(fix.lat, fix.lng, station.latitude, station.longitude))
  }

  // Sorting before the fold means each group lands at the position of its
  // nearest member, so the joined output is already in distance order.
  const sorted = eligible.slice().sort((a, b) => distances.get(a.id)! - distances.get(b.id)!)

  return joinDirectionalStations(sorted)
    .map(group => ({
      group,
      distanceM: Math.min(...group.members.map(member => distances.get(member.id)!))
    }))
    .filter(entry => entry.distanceM <= NEARBY_RADIUS_M)
    .slice(0, NEARBY_LIMIT)
}

/*
 * The one saved station the user is standing in, or null. Only ever one — the
 * nearest — so the home list moves a single card instead of reshuffling.
 */
export function findCurrentStation(stations: Station[], fix: Fix): Station | null {
  if (fix.accuracy > HERE_MAX_ACCURACY_M) return null

  let nearest: Station | null = null
  let nearestM = Infinity

  for (const station of stations) {
    if (!hasCoordinates(station)) continue

    const distanceM = haversineMeters(fix.lat, fix.lng, station.latitude, station.longitude)
    if (distanceM > HERE_RADIUS_M || distanceM >= nearestM) continue

    nearest = station
    nearestM = distanceM
  }

  return nearest
}

/** "70 m" / "1,2 km" — metres to the nearest ten, Indonesian decimal comma. */
export function formatDistance(meters: number): string {
  const rounded = Math.round(meters / 10) * 10
  if (rounded < 1000) return `${rounded} m`
  return `${(rounded / 1000).toFixed(1).replace('.', ',')} km`
}
