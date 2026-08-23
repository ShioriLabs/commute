import { useCallback, useEffect, useState } from 'react'

import {
  DEFAULT_FARE_ROUTER,
  readFareRouter,
  writeFareRouter,
  type FareRouter
} from 'utils/fare-router'

/**
 * The rider's chosen router, and whether that choice has been read yet.
 *
 * `routerReady` is the whole reason this returns three things rather than two.
 * The stored value cannot be read during render — see the note on the effect
 * below — so the first paint always says `standard`. Firing a query against
 * that would send a beta rider to /fares and then immediately to
 * /_internal/trips, warming a cache entry on an endpoint they will never read
 * from. Callers pass `routerReady` into useFareQuery's `gate` so nothing is
 * fetched until the answer is real. The criteria gate beside it exists for the
 * same reason, one layer down.
 *
 * Storage is the only input. There is no URL form of this setting, so a link
 * cannot put a rider on a router they did not choose, and every surface reading
 * this hook agrees by construction rather than by reconciliation.
 */
export function useFareRouter() {
  const [router, setRouterState] = useState<FareRouter>(DEFAULT_FARE_ROUTER)
  const [routerReady, setRouterReady] = useState(false)

  // Read after mount rather than in the initial state: this module is bundled
  // for a tree that also prerenders, where localStorage does not exist. The
  // default is the correct first paint either way, so there is no flash of a
  // result from the other router.
  // Once, on mount, like the criteria effect in use-fare-query.ts.
  useEffect(() => {
    setRouterState(readFareRouter())
    setRouterReady(true)
  }, [])

  const setRouter = useCallback((next: FareRouter) => {
    writeFareRouter(next)
    setRouterState(next)
  }, [])

  return { router, routerReady, setRouter }
}
