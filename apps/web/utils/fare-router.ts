// Which router answers a fare query. `standard` is /fares, one route. `beta`
// is /_internal/trips, several journeys labelled against each other. These are
// different answers, not one answer rendered twice.
//
// Kept out of FareCriteria on purpose. Criteria are query params the API prices
// under; this picks which endpoint is asked at all. Folding it in would send
// `?router=` to a server that ignores it while still splitting the SWR key, the
// service worker cache entry and the edge cache.
export type FareRouter = 'standard' | 'beta'

export const FARE_ROUTER_KEY = 'fare-router'
export const DEFAULT_FARE_ROUTER: FareRouter = 'standard'

/** `beta` only; anything else is the default. */
export function parseFareRouter(raw: string | null): FareRouter {
  return raw === 'beta' ? 'beta' : DEFAULT_FARE_ROUTER
}

export function readFareRouter(): FareRouter {
  try {
    return parseFareRouter(localStorage.getItem(FARE_ROUTER_KEY))
  } catch {
    // Storage throws in a partitioned or locked-down context — which is the
    // normal case inside the TransportForJakarta iframe, where Safari and
    // Firefox partition or deny it outright. Falling back to the standard
    // router is the right answer there: the embed keeps the response it has
    // always had, and the switch still flips for the session.
    return DEFAULT_FARE_ROUTER
  }
}

export function writeFareRouter(router: FareRouter) {
  try {
    localStorage.setItem(FARE_ROUTER_KEY, router)
  } catch {
    // See readFareRouter.
  }
}

/*
 * Do not give this a URL representation. Storage is the only source, so there
 * is one answer to "which router is this rider on" and nothing to reconcile.
 * A `?router=` param makes a shared link a third opinion alongside storage and
 * the toggle, and the rules it then needs — beta honoured but standard ignored,
 * applied for a visit but not persisted — cost more than they buy.
 *
 * Accept the consequence: a fare URL does not say which router produced it, and
 * nothing about it changes when the toggle moves.
 */
