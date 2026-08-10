import type { Context } from 'hono'
import type { FareContext } from '@commute/constants'
import type { Tsundere } from '@commute/tsundere'
import type { Bindings } from 'app'
import { KVRepository } from 'db/repositories/kv'
import { StationRepository } from 'db/repositories/stations'
import { fareTimeBucket } from 'utils/fare'
import { stationNamer, type StationNamer } from 'utils/fare-journey'
import { Internal, NotFound, Ok } from 'utils/response'
import { ServerTiming } from 'utils/server-timing'

/*
 * The request pipeline both journey endpoints run.
 *
 * /fares and /_internal/trips answer the same question with different shapes —
 * one route against several — but everything around the routing call is the
 * same: the SAME_STATION guard, the fare context, the phase timings, the KV
 * read-through, the endpoint existence check, the batched station hydration and
 * the error ladder. Holding that once is what stops the two drifting in their
 * error semantics, which is the failure a reader would never spot in review.
 *
 * What each endpoint still owns is the part that genuinely differs: which
 * routing call to make, and what shape to assemble from the result.
 */

/*
 * KV key for a journey answer.
 *
 * `prefix` separates the namespaces: the two endpoints return different shapes
 * for the same pair, and the beta router switch keeps both warm at once, so a
 * shared key would serve a TripResult to a caller parsing a FareResult.
 *
 * Keyed on payment method and time bucket because fare depends on both — peak
 * and off-peak, and the integrated-fare steps, must not share a cached body.
 */
export function journeyCacheKey(
  prefix: 'fares' | 'trips',
  fromId: string,
  toId: string,
  context: FareContext,
  apiVersion: string
): string {
  return `${prefix}:${fromId}:${toId}:${context.paymentMethod}:${fareTimeBucket(context.departureAt)}:${apiVersion}`
}

/** What the endpoint-specific half is handed once the shared work is done. */
export interface JourneyBuildTools {
  router: Tsundere
  timing: ServerTiming
  context: FareContext
  fromId: string
  toId: string
  /** Batched name lookup. Call with every station id the answer references. */
  hydrate: (stationIds: string[]) => Promise<StationNamer>
}

export interface JourneyEndpointOptions<T> {
  keyPrefix: 'fares' | 'trips'
  /*
   * Build the response body, or return null for "no route".
   *
   * Null rather than a thrown error because the two engines report it
   * differently — findRoute returns null, findRoutes an empty front — and both
   * mean a 404, not a 500.
   */
  build: (tools: JourneyBuildTools) => Promise<T | null>
}

export async function handleJourneyRequest<T>(
  c: Context<{ Bindings: Bindings }>,
  getRouter: (db: D1Database) => Promise<Tsundere>,
  parseContext: (paymentMethodRaw?: string, atRaw?: string) => FareContext,
  { keyPrefix, build }: JourneyEndpointOptions<T>
) {
  const fromId = c.req.param('from')!
  const toId = c.req.param('to')!
  if (fromId === toId) {
    return c.json(NotFound('SAME_STATION', 'Origin and destination are the same station.'), 404)
  }

  const context = parseContext(c.req.query('paymentMethod'), c.req.query('at'))

  /*
   * Phase timings, surfaced as Server-Timing on the response.
   *
   * The split is the point: routing is the part everyone assumes is expensive,
   * and off-worker measurement put it at ~0.5 ms against a 17-51 ms cold
   * request. This is how that gets confirmed on workerd rather than inferred
   * from a laptop benchmark.
   */
  const timing = new ServerTiming()

  const kvRepository = new KVRepository(c.env.KV)
  const kvKey = journeyCacheKey(keyPrefix, fromId, toId, context, c.env.API_VERSION)

  const cached = await timing.measure('kv', () => kvRepository.get<T>(kvKey))
  if (cached) {
    // A hit is the whole request, so `kv` alone already tells the story: no
    // route was computed, and the absence of the other spans says so.
    c.header('Server-Timing', timing.header())
    return c.json(Ok(cached), 200)
  }

  const stationRepository = new StationRepository(c.env.DB)

  try {
    const endpoints = await timing.measure('endpoints', () => stationRepository.getByIds([fromId, toId]))
    if (endpoints.length < 2) {
      return c.json(NotFound('UNKNOWN_STATION', 'One or both stations do not exist.'), 404)
    }

    // Cached per isolate, so this is ~0 on every request after the first.
    const router = await timing.measure('graph', () => getRouter(c.env.DB))

    const result = await build({
      router,
      timing,
      context,
      fromId,
      toId,
      hydrate: async (stationIds) => {
        const stations = await timing.measure('hydrate', () => stationRepository.getByIds(stationIds))
        return stationNamer(stations)
      }
    })

    if (result === null) {
      return c.json(NotFound('NO_ROUTE', 'No route between these stations.'), 404)
    }

    c.executionCtx.waitUntil(kvRepository.set(kvKey, result))

    c.header('Server-Timing', timing.header())
    return c.json(Ok(result), 200)
  } catch (error) {
    console.error(error)
    return c.json(Internal('DATABASE_ERROR', 'Can\'t connect to database, please try again later.'), 500)
  }
}
