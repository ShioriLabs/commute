// Which router answers a fare query.
//
// `standard` is /fares: one route, the answer this app has always given, and
// the one the OG card and the TransportForJakarta embed are built around.
// `beta` is /_internal/trips: several journeys, each labelled against the
// others. They are genuinely different answers, not the same answer rendered
// twice — findRoutes weighs a saved boarding against a longer ride, so on some
// pairs it leads with a route /fares would rank second (Bogor -> Lebak Bulus
// becomes a one-transfer Rp 20.000 route where /fares returns the
// three-transfer Rp 17.500 one).
//
// Kept out of FareCriteria on purpose. Criteria are query params the API is
// asked to price under; this picks which endpoint is asked at all. Folding it
// in would send `?router=` to a server that ignores it while still splitting
// the SWR key, the service worker's cache entry and the edge cache.
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
 * Deliberately no URL representation.
 *
 * The router lives in storage and nowhere else, so there is exactly one answer
 * to "which router is this rider on" and no second source to reconcile it
 * against. A `?router=` param was tried and removed: it made a shared or
 * reported link a third opinion alongside storage and the toggle, and the
 * reconciliation rules it needed — beta honoured but standard ignored, applied
 * for a visit but not persisted — were more machinery than the diagnosis it
 * bought.
 *
 * The consequence to accept is that a URL alone does not say which router
 * produced an answer. Nothing about a fare URL changes when the toggle moves.
 */
