import { createMiddleware } from 'hono/factory'
import type { Bindings } from '../app'
import { refreshObservedHeadwaysFlag, refreshObservedRuntimesFlag } from '../utils/observedFlag'

/*
 * Refreshes the observed-headways kill switch and the observed-runtimes mode
 * before the handler runs, so the synchronous planner map, cache scope and
 * retime read current values, and pins them to the request so the cache key and
 * the search cannot disagree. See utils/observedFlag.ts. Mounted only on the
 * routes that read headways.
 */
export function observedFlag() {
  return createMiddleware<{ Bindings: Bindings }>(async (c, next) => {
    await Promise.all([
      refreshObservedHeadwaysFlag(c.env?.KV, c.req.raw),
      refreshObservedRuntimesFlag(c.env?.KV, c.req.raw)
    ])
    await next()
  })
}
