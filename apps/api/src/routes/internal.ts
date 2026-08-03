import { Hono } from 'hono'
import type { FareContext } from '@commute/constants'
import { Bindings } from 'app'
import { HubRepository } from 'db/repositories/hubs'
import { KVRepository } from 'db/repositories/kv'
import { StationRepository } from 'db/repositories/stations'
import { TripResult } from 'models/fare'
import { getRouter, parseFareContext } from 'routes/fares'
import { fareTimeBucket } from 'utils/fare'
import { assembleJourney, planJourney, stationNamer } from 'utils/fare-journey'
import { summarizeFares } from 'utils/fare-summary'
import { mergeInterlinedLegs } from 'utils/interlining'
import { Internal, NotFound, Ok } from 'utils/response'
import { buildSearchableIndex } from 'utils/searchables'

/*
 * Endpoints shaped for commute.shiorilabs.id specifically.
 *
 * `_internal` is a deliberate label, not access control: everything here is as
 * reachable as the rest of the API. It means "this response is shaped around one
 * consumer's screen and carries no compatibility promise" — it may change shape
 * whenever the web app's needs change. Anything you'd want to build against
 * belongs on a public route instead.
 */
const app = new Hono<{ Bindings: Bindings }>()

/** KV key for the prebuilt search index. Shared with cache.ts and sync.ts. */
export const searchablesKVKey = (apiVersion: string) => `searchables:${apiVersion}`

/*
 * The search sheet's entire index in one response: stations (directional halte
 * pairs pre-folded), hubs, and rail lines, already in the client's `Searchable`
 * shape. Replaces a /stations + /hubs + /operators fan-out that shipped ~257 KB
 * of mostly-unused station columns and re-derived this index on every mount.
 */
app.get('/searchables', async (c) => {
  const kvRepository = new KVRepository(c.env.KV)

  const kvKey = searchablesKVKey(c.env.API_VERSION)

  const cachedIndex = await kvRepository.get(kvKey)
  if (cachedIndex) {
    return c.json(
      Ok(cachedIndex),
      200
    )
  }

  const stationRepository = new StationRepository(c.env.DB)
  const hubRepository = new HubRepository(c.env.DB)

  const [stations, hubs] = await Promise.all([
    stationRepository.getAll(),
    hubRepository.getAll()
  ])

  const index = buildSearchableIndex(stations, hubs)

  if (index.items.length > 0) {
    c.executionCtx.waitUntil(
      kvRepository.set(kvKey, index)
    )
  }

  return c.json(
    Ok(index),
    200
  )
})

/** KV key for a trip answer. Distinct namespace from `fares:` — different shape. */
export const tripCacheKey = (fromId: string, toId: string, context: FareContext, apiVersion: string): string =>
  `trips:${fromId}:${toId}:${context.paymentMethod}:${fareTimeBucket(context.departureAt)}:${apiVersion}`

/*
 * Several journeys for one station pair, each priced.
 *
 * The multi-criteria answer, kept here rather than on `/fares/:from/:to` because
 * the two genuinely differ: findRoutes weighs a saved boarding against a longer
 * ride, so it picks a different primary on some pairs (Bogor -> Lebak Bulus
 * becomes a one-transfer Rp 20.000 route where /fares returns the
 * three-transfer Rp 17.500 one). /fares is the shared URL, the OG card and the
 * TransportForJakarta embed, so its answer must not move until that is
 * deliberately released.
 *
 * Rendering is identical either way: both go through utils/fare-journey.ts, so
 * a leg looks the same on both endpoints. Only the number of journeys differs.
 */
app.get('/trips/:from/:to', async (c) => {
  const fromId = c.req.param('from')
  const toId = c.req.param('to')
  if (fromId === toId) {
    return c.json(NotFound('SAME_STATION', 'Origin and destination are the same station.'), 404)
  }

  const context = parseFareContext(c.req.query('paymentMethod'), c.req.query('at'))
  const kvRepository = new KVRepository(c.env.KV)
  const kvKey = tripCacheKey(fromId, toId, context, c.env.API_VERSION)

  const cached = await kvRepository.get<TripResult>(kvKey)
  if (cached) return c.json(Ok(cached), 200)

  const stationRepository = new StationRepository(c.env.DB)

  try {
    const endpoints = await stationRepository.getByIds([fromId, toId])
    if (endpoints.length < 2) {
      return c.json(NotFound('UNKNOWN_STATION', 'One or both stations do not exist.'), 404)
    }

    const router = await getRouter(c.env.DB)
    const routed = router.findRoutes(fromId, toId, {
      /*
       * Pricing the journeys is what makes the CHEAPEST label reachable at all —
       * without a scorer every journey's `fare` criterion is null and the axis
       * is skipped as incomparable.
       *
       * The legs are merged first, exactly as planJourney merges them, so the
       * fare a label was decided on and the fare the rider sees are computed
       * over the same decomposition. Scoring raw legs would let them disagree.
       */
      scoreFare: legs => summarizeFares(mergeInterlinedLegs([...legs]), context).totalFare
    })
    // findRoutes reports "no route" as an empty front, where findRoute returns null.
    if (routed.length === 0) {
      return c.json(NotFound('NO_ROUTE', 'No route between these stations.'), 404)
    }

    const plans = routed.map(journey => planJourney(journey.legs, journey.criteria, journey.labels, context))

    /*
     * One batched lookup across every journey, which is why planJourney reports
     * the ids it needs instead of resolving names itself. Journeys between the
     * same pair overlap heavily, so the union is barely larger than a single
     * journey's set, and a query per journey would cost more than the search
     * that produced them.
     */
    const stations = await stationRepository.getByIds([...new Set(plans.flatMap(p => p.stationIds))])
    const namer = stationNamer(stations)

    const result: TripResult = {
      from: namer.ref(fromId),
      to: namer.ref(toId),
      journeys: plans.map(plan => assembleJourney(plan, namer, context))
    }

    c.executionCtx.waitUntil(kvRepository.set(kvKey, result))

    return c.json(Ok(result), 200)
  } catch (error) {
    console.error(error)
    return c.json(Internal('DATABASE_ERROR', 'Can\'t connect to database, please try again later.'), 500)
  }
})

export default app
