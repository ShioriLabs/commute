/*
 * Kill switch for the observed headways.
 *
 *   wrangler kv key put --binding KV config:observed-headways off --remote
 *   wrangler kv key delete --binding KV config:observed-headways --remote
 *
 * Anything other than the value `off` (including no key at all) leaves them on,
 * so a lost key fails towards the shipped behaviour rather than silently
 * reverting. Read with a 60 s edge cache, the same pattern as the upload flag in
 * routes/uploads.ts, so a flip reaches every colo within about a minute.
 *
 * Held per isolate, because the planner's headway map and the journey cache
 * scope are built synchronously. It is refreshed at the start of each request
 * by middleware/observed-flag.ts. The value is a single boolean that only ever
 * changes to the answer KV just gave, so interleaved requests cannot corrupt it;
 * the worst case is one request using the previous value, which is the same
 * staleness the edge cache already allows.
 */
export const OBSERVED_HEADWAYS_FLAG_KEY = 'config:observed-headways'
export const OBSERVED_FLAG_CACHE_TTL = 60

let enabled = true

/*
 * The value one request saw when it started.
 *
 * The module boolean above is shared by every request in the isolate, and a
 * request reads it at several points separated by awaits: the journey cache key
 * (scope), then the search (timeOptions), then the reopening probe. A concurrent
 * request whose middleware flips the boolean in between would let one request
 * key a body under one regime and compute it under the other, and the entry
 * lives 20 hours. So the request's own value is captured once, keyed by the
 * request object, and everything on that request reads the capture.
 */
const perRequest = new WeakMap<Request, boolean>()

/** The module-wide last value. Use `observedHeadwaysEnabledFor` on a request path. */
export function observedHeadwaysEnabled(): boolean {
  return enabled
}

/** The value this request started with, falling back to the module value (tests, scripts). */
export function observedHeadwaysEnabledFor(request: Request): boolean {
  return perRequest.get(request) ?? enabled
}

export async function refreshObservedHeadwaysFlag(kv: KVNamespace | undefined, request?: Request): Promise<void> {
  // No binding (local dev, tests): keep whatever was last set.
  if (kv) {
    try {
      enabled = (await kv.get(OBSERVED_HEADWAYS_FLAG_KEY, { cacheTtl: OBSERVED_FLAG_CACHE_TTL })) !== 'off'
    } catch {
      // A KV hiccup must not flip planner behaviour; keep the last value.
    }
  }
  // Captured AFTER the read, from the value this request just obtained, so every
  // later read on the request agrees with the one it keyed its cache entry on.
  if (request) perRequest.set(request, enabled)
}

/** Test seam: set the held value directly. */
export function setObservedHeadwaysEnabled(value: boolean): void {
  enabled = value
}

/*
 * Mode switch for the observed TransJakarta run times (utils/observedRuntimes.ts).
 *
 *   wrangler kv key put --binding KV config:observed-runtimes fields --remote
 *   wrangler kv key put --binding KV config:observed-runtimes off --remote
 *   wrangler kv key delete --binding KV config:observed-runtimes --remote   # back to sort
 *
 *   off     no estimates at all
 *   fields  `estimate` on journeys, in the engine's order with timetabled
 *           arrivals first, as before sort shipped
 *   sort    estimates also take part in the arrival order (journey-times.ts
 *           byArrival). The default since 2026-10-23, and what any unknown
 *           value or a missing key means: the search ranks without counting
 *           walk or ride time, so its own order put a 560 m walk to a 13E
 *           (±22) over Galunggung + 6 (±18) from Sudirman, and the arrival
 *           order is the one a rider can check.
 *
 * The estimates are applied after the journey cache (journey-endpoint `retime`),
 * so a flip needs no cache scope and no purge: it reaches riders as fast as the
 * 60 s KV edge cache and the /_internal edge cache (max-age 600) allow.
 * Pinned per request like the headway switch, so one request never mixes modes.
 */
export const OBSERVED_RUNTIMES_FLAG_KEY = 'config:observed-runtimes'

export type RuntimesMode = 'off' | 'fields' | 'sort'

const parseRuntimesMode = (value: string | null): RuntimesMode => (value === 'off' || value === 'fields' ? value : 'sort')

let runtimesMode: RuntimesMode = 'sort'
const runtimesPerRequest = new WeakMap<Request, RuntimesMode>()

/** The mode this request started with, falling back to the module value (tests, scripts). */
export function observedRuntimesModeFor(request: Request): RuntimesMode {
  return runtimesPerRequest.get(request) ?? runtimesMode
}

export async function refreshObservedRuntimesFlag(kv: KVNamespace | undefined, request?: Request): Promise<void> {
  if (kv) {
    try {
      runtimesMode = parseRuntimesMode(await kv.get(OBSERVED_RUNTIMES_FLAG_KEY, { cacheTtl: OBSERVED_FLAG_CACHE_TTL }))
    } catch {
      // A KV hiccup must not flip the order riders see; keep the last value.
    }
  }
  if (request) runtimesPerRequest.set(request, runtimesMode)
}

/** Test seam: set the held mode directly. */
export function setObservedRuntimesMode(mode: RuntimesMode): void {
  runtimesMode = mode
}
