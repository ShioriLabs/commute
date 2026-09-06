import type { Context } from 'hono'
import type { FareContext } from '@commute/constants'
import type { Tsundere } from '@commute/tsundere'
import type { Bindings } from 'app'
import { KVRepository } from 'db/repositories/kv'
import { StationRepository } from 'db/repositories/stations'
import { fareTimeBucket, serviceDay } from 'utils/fare'
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
 *
 * The service day joins them because routing now depends on it too: lines run
 * on different days and at different frequencies, so a Saturday answer served
 * from a Tuesday key would route onto a corridor that is not running.
 */
export function journeyCacheKey(
  prefix: 'fares' | 'trips',
  fromId: string,
  toId: string,
  context: FareContext,
  apiVersion: string
): string {
  const day = serviceDay(context.departureAt)
  return `${prefix}:${fromId}:${toId}:${context.paymentMethod}:${day}:${fareTimeBucket(context.departureAt)}:${apiVersion}`
}

/*
 * How long a CLOSED answer stays cached. Short, because the cache key's time
 * component is only peak/off-peak and cannot express a 05:00 opening.
 */
const CLOSED_CACHE_TTL_S = 5 * 60

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

/*
 * A trip that no line can carry right now, but which a line could carry later.
 *
 * Distinct from "no route" on purpose: a rider standing at a halte at 03:00
 * needs to know the bus starts at 05:00, not that their trip is impossible.
 * Carrying the reopening time is what makes the answer actionable — "closed"
 * on its own leaves them with nothing to do.
 */
export interface ClosedOutcome {
  outcome: 'CLOSED'
  /** When the trip next becomes possible, as a local (WIB) ISO timestamp. */
  nextServiceAt: string
}

/** A body, `null` for no route at any time, or CLOSED for "not right now". */
export type JourneyOutcome<T> = T | null | ClosedOutcome

export function isClosed<T>(result: JourneyOutcome<T>): result is ClosedOutcome {
  return result !== null && typeof result === 'object' && 'outcome' in result && result.outcome === 'CLOSED'
}

export interface JourneyEndpointOptions<T> {
  keyPrefix: 'fares' | 'trips'
  /*
   * Build the response body, return null for "no route", or a ClosedOutcome
   * when a path exists but nothing serving it is running yet.
   *
   * Null rather than a thrown error because the two engines report it
   * differently — findRoute returns null, findRoutes an empty front — and both
   * mean a 404, not a 500.
   */
  build: (tools: JourneyBuildTools) => Promise<JourneyOutcome<T>>
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

  const cached = await timing.measure('kv', () => kvRepository.get<JourneyOutcome<T>>(kvKey))
  if (cached) {
    // A hit is the whole request, so `kv` alone already tells the story: no
    // route was computed, and the absence of the other spans says so.
    c.header('Server-Timing', timing.header())
    // A cached CLOSED must replay as CLOSED. Handing it back through Ok would
    // serve `{outcome: 'CLOSED'}` to a caller parsing a journey list.
    if (isClosed(cached)) {
      return c.json(
        {
          status: 404,
          error: {
            code: 'CLOSED',
            message: 'No service on this route at that time.',
            nextServiceAt: cached.nextServiceAt
          }
        },
        404
      )
    }
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

    /*
     * Closed is still a 404 — there is no journey to return — but a different
     * code, so a caller can tell "come back at 05:00" from "this pair is not
     * connected" without parsing prose.
     *
     * Cached briefly rather than for the usual 20 hours. The key carries the
     * peak/off-peak bucket, which is far coarser than a service-hour boundary:
     * 04:30 and 06:00 are both off-peak on a weekday, so a full-length cache
     * would keep serving "closed" long after the line opened. A short TTL fixes
     * that without widening the key and costing the OK path its hit rate.
     */
    if (isClosed(result)) {
      c.executionCtx.waitUntil(kvRepository.set(kvKey, result, CLOSED_CACHE_TTL_S))
      c.header('Server-Timing', timing.header())
      return c.json(
        {
          status: 404,
          error: {
            code: 'CLOSED',
            message: 'No service on this route at that time.',
            nextServiceAt: result.nextServiceAt
          }
        },
        404
      )
    }

    c.executionCtx.waitUntil(kvRepository.set(kvKey, result))

    c.header('Server-Timing', timing.header())
    return c.json(Ok(result), 200)
  } catch (error) {
    console.error(error)
    return c.json(Internal('DATABASE_ERROR', 'Can\'t connect to database, please try again later.'), 500)
  }
}
