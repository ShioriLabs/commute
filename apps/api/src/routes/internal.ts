import { Hono } from 'hono'
import type { FareContext } from '@commute/constants'
import { Bindings } from 'app'
import { HubRepository } from 'db/repositories/hubs'
import { KVRepository } from 'db/repositories/kv'
import { StationRepository } from 'db/repositories/stations'
import type { TripResult } from '@commute/schemas'
import { getRouter, parseFareContext } from 'routes/fares'
import { assembleJourney, planJourney } from 'utils/fare-journey'
import { handleJourneyRequest, journeyCacheKey } from 'utils/journey-endpoint'
import { summarizeFares } from 'utils/fare-summary'
import { mergeInterlinedLegs } from 'utils/interlining'
import { Ok } from 'utils/response'
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
  journeyCacheKey('trips', fromId, toId, context, apiVersion)

/*
 * Several journeys for one station pair, each priced.
 *
 * The multi-criteria answer, kept here rather than on `/fares/:from/:to` because
 * the two genuinely differ: findRoutes weighs a saved boarding against a longer
 * ride, so it picks a different primary on some pairs (Bogor -> Lebak Bulus
 * becomes a one-transfer Rp 20.000 route where /fares returns the
 * three-transfer Rp 17.500 one). /fares is the shared URL, the OG card and the
 * TransportForJakarta embed, so its answer does not move for anyone who has not
 * asked for this one.
 *
 * Asking is now a rider-facing choice — the beta router toggle on /fare — rather
 * than an unlisted route. That is why the split survives: a switch picks between
 * two endpoints that each answer honestly, where a mode flag on /fares would
 * have made one URL mean two different things.
 *
 * Rendering is identical either way: both go through utils/fare-journey.ts, so
 * a leg looks the same on both endpoints. Only the number of journeys differs.
 */
app.get('/trips/:from/:to', async c => handleJourneyRequest<TripResult>(c, getRouter, parseFareContext, {
  keyPrefix: 'trips',
  /*
   * The same phase timings as /fares, and the more interesting of the two: this
   * is the multi-criteria search, roughly ten times the work of findRoute. If
   * routing is ever going to dominate a request, it is here rather than there.
   */
  build: async ({ router, timing, context, fromId, toId, hydrate }) => {
    const routed = timing.measureSync('route', () => router.findRoutes(fromId, toId, {
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
    }))
    // findRoutes reports "no route" as an empty front, where findRoute returns null.
    if (routed.length === 0) return null

    const plans = timing.measureSync('plan', () => routed.map(journey => planJourney(journey.legs, journey.criteria, journey.labels, context)))

    /*
     * One batched lookup across every journey, which is why planJourney reports
     * the ids it needs instead of resolving names itself. Journeys between the
     * same pair overlap heavily, so the union is barely larger than a single
     * journey's set, and a query per journey would cost more than the search
     * that produced them.
     */
    const namer = await hydrate([...new Set(plans.flatMap(p => p.stationIds))])

    return timing.measureSync('assemble', () => ({
      from: namer.ref(fromId),
      to: namer.ref(toId),
      journeys: plans.map(plan => assembleJourney(plan, namer, context))
    }))
  }
}))

export default app
