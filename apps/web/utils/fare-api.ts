import { fareQueryParams, type FareCriteria } from 'utils/fare-criteria'

// Shared SWR wiring for the fare endpoint.
//
// The fare fetch happens on three surfaces — the /fare route, the search
// sheet's route mode, and the map's route overlay. SWR dedupes across them
// only when the key string and config agree, so both live here rather than in
// any one caller.

export const FARE_SWR_CONFIG = {
  dedupingInterval: import.meta.env.DEV ? 0 : 60 * 60 * 1000,
  focusThrottleInterval: import.meta.env.DEV ? 0 : 60 * 60 * 1000,
  revalidateOnFocus: false,
  shouldRetryOnError: false
}

// SWR key for a fare pair; null (no fetch) unless both ends are set and
// distinct — the API would answer SAME_STATION anyway.
//
// Criteria are part of the key, not an afterthought: the same pair priced
// under a different payment method is a different answer, and folding it into
// the URL is what keeps the /fare route and the map overlay sharing one cache
// entry instead of quietly showing two different numbers.
export function fareApiUrl(
  fromId: string | null | undefined,
  toId: string | null | undefined,
  criteria?: FareCriteria
): string | null {
  return journeyApiUrl('/fares', fromId, toId, criteria)
}

/*
 * SWR key for the same pair on `/_internal/trips`, which answers with every
 * journey worth choosing between rather than one route.
 *
 * A separate endpoint on purpose: findRoutes weighs a saved boarding against a
 * longer ride, so it picks a different primary on some pairs, and `/fares` is
 * the shared URL, the OG card and the TransportForJakarta embed. Its answer does
 * not move for anyone who has not asked for the other one — which is what the
 * router toggle asks, per rider, and why the two endpoints stay distinct rather
 * than one growing a mode flag.
 *
 * Distinct paths also mean distinct SWR keys, so neither surface can render the
 * other's cached body — including the flip itself, where both are warm for the
 * same pair at once.
 */
export function tripApiUrl(
  fromId: string | null | undefined,
  toId: string | null | undefined,
  criteria?: FareCriteria
): string | null {
  return journeyApiUrl('/_internal/trips', fromId, toId, criteria)
}

function journeyApiUrl(
  path: string,
  fromId: string | null | undefined,
  toId: string | null | undefined,
  criteria?: FareCriteria
): string | null {
  if (!fromId || !toId || fromId === toId) return null
  const query = criteria ? fareQueryParams(criteria).toString() : ''
  return new URL(
    `${path}/${fromId}/${toId}${query ? `?${query}` : ''}`,
    import.meta.env.VITE_API_BASE_URL
  ).href
}
