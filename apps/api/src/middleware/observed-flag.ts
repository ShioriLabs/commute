import { createMiddleware } from 'hono/factory'
import type { Bindings } from '../app'
import { refreshObservedHeadwaysFlag } from '../utils/observedFlag'

/*
 * Refreshes the observed-headways kill switch before the handler runs, so the
 * synchronous planner map and cache scope read a current value, and pins that
 * value to the request so the cache key and the search cannot disagree. See
 * utils/observedFlag.ts. Mounted only on the routes that read headways.
 */
export function observedFlag() {
  return createMiddleware<{ Bindings: Bindings }>(async (c, next) => {
    await refreshObservedHeadwaysFlag(c.env?.KV, c.req.raw)
    await next()
  })
}
