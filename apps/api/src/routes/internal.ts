import { Hono } from 'hono'
import type { FareContext } from '@commute/constants'
import { Bindings } from 'app'
import { HubRepository } from 'db/repositories/hubs'
import { KVRepository } from 'db/repositories/kv'
import { StationRepository } from 'db/repositories/stations'
import type { TripResult } from '@commute/schemas'
import { weightsForWalking, type RankWeights, type WalkingPreference } from '@commute/tsundere'
import { getRouter, linesOf, nextServiceAt, parseFareContext, timeOptions } from 'routes/fares'
import { wibIsoString } from 'utils/fare'
import { assembleJourney, planJourney } from 'utils/fare-journey'
import { handleJourneyRequest, journeyCacheKey } from 'utils/journey-endpoint'
import { retimeTrips } from 'utils/journey-times'
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
 * This is what the app renders, everywhere. The split survives anyway, because
 * the two endpoints answer different questions honestly: /fares is a frozen
 * public contract for the OG card, shared links and the embed, and a mode flag
 * on it would have made one URL mean two different things.
 *
 * Rendering is identical either way: both go through utils/fare-journey.ts, so
 * a leg looks the same on both endpoints. Only the number of journeys differs.
 */
/*
 * Which operators the rider is willing to use.
 *
 * Only one exclusion is offered today — `?modes=rail` drops TransJakarta — and
 * it is deliberately an enum rather than a free list of operators. TJ is 61% of
 * the searchable network and the only bridge to LRT Jakarta, so "rail only" is
 * a genuinely different product rather than one filter among many; letting a
 * caller exclude arbitrary operators would promise a matrix nobody has checked.
 *
 * Anything unrecognised means no exclusion, matching how parseFareContext
 * treats a malformed value: a query param the rider did not knowingly set must
 * not silently shrink their network.
 */
function excludedLines(modesRaw?: string): ReadonlySet<string> | undefined {
  return modesRaw === 'rail' ? linesOf('TJ') : undefined
}

const WALKING_PREFERENCES: ReadonlySet<string> = new Set(['BRISK', 'AVERAGE', 'SLOW', 'AVOID'])

/*
 * How much the rider minds walking, as rank weights.
 *
 * A PREFERENCE, not a speed. The engine has no duration model — every edge's
 * `durationSeconds` is null — so this cannot say a journey takes eight minutes
 * longer at your pace. It shifts which tradeoffs win: weight walking harder and
 * a 600m transfer stops beating an extra boarding.
 *
 * Undefined for the default, so the search runs on DEFAULT_RANK_WEIGHTS exactly
 * as it did before this existed. AVERAGE is that default, so it is spelled the
 * same way an absent param is.
 */
function walkingWeights(walkingRaw?: string): RankWeights | undefined {
  if (walkingRaw === undefined || walkingRaw === 'AVERAGE') return undefined
  return WALKING_PREFERENCES.has(walkingRaw as WalkingPreference)
    ? weightsForWalking(walkingRaw as WalkingPreference)
    : undefined
}

app.get('/trips/:from/:to', async c => handleJourneyRequest<TripResult>(c, getRouter, parseFareContext, {
  keyPrefix: 'trips',
  /*
   * Both params change the ANSWER — one excludes lines, the other reorders the
   * front — so both join the key, or a rider is served someone else's route
   * from a 20-hour entry. Undefined for a default search, which keeps that key
   * byte-identical to the one before either existed and every warm entry warm.
   */
  /*
   * Clock times go on here, not in `build` — so they are applied to a cached
   * body as well as a fresh one, and never written into KV. The route is the
   * cacheable half; the vehicle you catch is the per-request half.
   */
  retime: async (result, c) => retimeTrips(
    result,
    await getRouter(c.env.DB),
    parseFareContext(c.req.query('paymentMethod'), c.req.query('at'))
  ),
  scope: (c) => {
    const parts = [
      c.req.query('modes') === 'rail' ? 'rail' : null,
      walkingWeights(c.req.query('walking')) ? c.req.query('walking') : null
    ].filter(Boolean)
    return parts.length > 0 ? parts.join('+') : undefined
  },
  /*
   * The same phase timings as /fares, and the more interesting of the two: this
   * is the multi-criteria search, roughly ten times the work of findRoute. If
   * routing is ever going to dominate a request, it is here rather than there.
   */
  build: async ({ router, timing, context, fromId, toId, hydrate }) => {
    const routed = timing.measureSync('route', () => router.findRoutes(fromId, toId, {
      /*
       * When the rider is travelling, which decides both which lines are
       * running at all and how often they come. Omitting these is what the
       * search did before service hours existed.
       */
      ...timeOptions(context),
      /*
       * Lines the rider will not board. Boarding-only, so a walk between two
       * haltes is still offered and a ride already under way is never cut.
       */
      excludeLines: excludedLines(c.req.query('modes')),
      /*
       * Reorders the front; never prunes it. A rider who avoids walking still
       * gets the footbridge route offered, just ranked below the alternatives.
       */
      weights: walkingWeights(c.req.query('walking')),
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
    /*
     * findRoutes reports "no route" as an empty front, where findRoute returns
     * null. An empty front has two very different causes, and the rider needs
     * them told apart: either nothing connects these stations at all, or
     * everything that does is shut right now.
     *
     * The second is only worth asking about when the search was time-filtered
     * in the first place, and only costs anything when the answer was empty —
     * so the probe sits behind both conditions rather than on the hot path.
     */
    if (routed.length === 0) {
      const reopening = timing.measureSync('reopen', () => nextServiceAt(router, fromId, toId, context, excludedLines(c.req.query('modes'))))
      if (!reopening) return null
      return {
        outcome: 'CLOSED' as const,
        nextServiceAt: wibIsoString(reopening.at)
      }
    }

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
