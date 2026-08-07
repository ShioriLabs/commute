import { Hono } from 'hono'
import { FareContext, PAYMENT_METHODS, PaymentMethod } from '@commute/constants'
import { Bindings } from 'app'
import { EdgeRepository } from 'db/repositories/edges'
import { KVRepository } from 'db/repositories/kv'
import { StationRepository } from 'db/repositories/stations'
import { FareResult } from 'models/fare'
import { fareTimeBucket } from 'utils/fare'
import { assembleJourney, planJourney, stationNamer } from 'utils/fare-journey'
import { Internal, NotFound, Ok } from 'utils/response'
import { ENDPOINT_RESTRICTIONS, SERVICE_BREAKS } from 'db/data/topology'
import { loadGraph, type Tsundere } from '@commute/tsundere'
import { HEADWAYS_S } from 'db/data/headways'
import { doc, pathParam, queryParam } from 'schemas/describe'
import { FareResultSchema } from '@commute/schemas'

const app = new Hono<{ Bindings: Bindings }>()

// Graph inputs only change with deploys/reseeds; cache the loaded engine per
// isolate. Rebuilding it per request would re-read every edge and transfer row.
// Exported so /_internal/trips shares this instance rather than loading a second
// copy of the same graph into the same isolate.
let cachedRouter: Tsundere | null = null
export async function getRouter(d1: D1Database): Promise<Tsundere> {
  if (cachedRouter) return cachedRouter
  const { edges, transfers } = await new EdgeRepository(d1).getGraphInputs()
  // Topology restrictions are authored in (operator, station) codes; the graph
  // works in `${operator}-${station}` DB ids. tsundere treats node ids as
  // opaque, so this mapping stays here rather than in the engine.
  const restrictions = ENDPOINT_RESTRICTIONS.map(r => ({
    stationId: `${r.operator}-${r.station}`,
    forbiddenNeighborId: `${r.operator}-${r.forbiddenNeighbor}`
  }))
  const serviceBreaks = SERVICE_BREAKS.map(b => ({
    lineCode: b.lineCode,
    viaStationId: `${b.operator}-${b.via}`,
    fromStationId: `${b.operator}-${b.from}`,
    toStationId: `${b.operator}-${b.to}`
  }))
  cachedRouter = loadGraph({
    edges,
    transfers,
    restrictions,
    // Read by findRoutes only; /fares keeps the answer it has always given.
    serviceBreaks,
    // Read by findRoutes to price the expected wait per boarding, which is what
    // separates journeys that are otherwise equal on distance and changes.
    headwaysS: new Map(Object.entries(HEADWAYS_S))
  })
  return cachedRouter
}

// Resolve the fare context from optional query params, defaulting to today's
// behaviour: single-tap stored value, departing now. Unknown/malformed values
// fall back to the defaults rather than erroring.
export function parseFareContext(paymentMethodRaw?: string, atRaw?: string): FareContext {
  const paymentMethod: PaymentMethod
    = paymentMethodRaw && paymentMethodRaw in PAYMENT_METHODS
      ? paymentMethodRaw as PaymentMethod
      : 'STORED_VALUE'
  const parsed = atRaw ? new Date(atRaw) : null
  const departureAt = parsed && !Number.isNaN(parsed.getTime()) ? parsed : new Date()
  return { paymentMethod, departureAt }
}

// Fare depends on payment method + time bucket; key on both so peak/off-peak
// and integrated fares (steps 2 & 4) can't be served a stale cached body.
export function fareCacheKey(fromId: string, toId: string, context: FareContext, apiVersion: string): string {
  return `fares:${fromId}:${toId}:${context.paymentMethod}:${fareTimeBucket(context.departureAt)}:${apiVersion}`
}

app.get(
  '/:from/:to',
  doc({
    summary: 'Tarif dan rute antara dua stasiun',
    description: 'Mencari rute perjalanan sekaligus menghitung tarifnya. `legs` adalah perjalanan dari sisi penumpang: naik apa saja dan jalan kaki di mana saja. `segments` adalah cara tarifnya dihitung, yang bisa berbeda karena tiap operator menagih per perjalanan di jaringan mereka sendiri. Tarif integrasi sudah dihitung di `totalFare`.',
    tag: 'Tarif',
    data: FareResultSchema,
    parameters: [
      pathParam('from', 'Station id asal, `{operator}-{code}`.', 'KCI-SUD'),
      pathParam('to', 'Station id tujuan.', 'MRTJ-LBB'),
      queryParam('paymentMethod', 'Menentukan tarif mana yang dipakai. Default-nya tarif kartu uang elektronik biasa.'),
      queryParam('at', 'Timestamp ISO 8601 buat perjalanannya, dipakai buat menentukan tarif peak atau off-peak. Default-nya waktu sekarang.', '2026-07-28T08:00:00Z')
    ],
    errors: {
      404: 'Salah satu stasiunnya tidak ditemukan, tidak ada rute di antara keduanya, atau asal dan tujuannya sama (`SAME_STATION`).',
      500: 'Perhitungan tarif gagal (`DATABASE_ERROR`).'
    }
  }),
  async (c) => {
    const fromId = c.req.param('from')
    const toId = c.req.param('to')
    if (fromId === toId) {
      return c.json(NotFound('SAME_STATION', 'Origin and destination are the same station.'), 404)
    }

    const context = parseFareContext(c.req.query('paymentMethod'), c.req.query('at'))

    const kvRepository = new KVRepository(c.env.KV)
    const kvKey = fareCacheKey(fromId, toId, context, c.env.API_VERSION)

    const cached = await kvRepository.get<FareResult>(kvKey)
    if (cached) {
      return c.json(Ok(cached), 200)
    }

    const stationRepository = new StationRepository(c.env.DB)

    try {
      const endpoints = await stationRepository.getByIds([fromId, toId])
      if (endpoints.length < 2) {
        return c.json(NotFound('UNKNOWN_STATION', 'One or both stations do not exist.'), 404)
      }

      const router = await getRouter(c.env.DB)
      /*
       * Still findRoute, singular, and deliberately so.
       *
       * findRoutes picks a different primary on some pairs — it weighs a saved
       * boarding against a longer ride, so Bogor -> Lebak Bulus becomes a
       * one-transfer Rp 20.000 route where this returns the three-transfer
       * Rp 17.500 one. Neither is wrong, but this endpoint is the shared URL,
       * the OG card and the TransportForJakarta embed, so its answer should not
       * move until that change is deliberately released.
       *
       * The multi-journey answer lives at `/_internal/trips/:from/:to`, which
       * carries no compatibility promise. Both call the same pipeline in
       * utils/fare-journey.ts, so they cannot drift apart in how they render a
       * journey — only in how many they return.
       */
      const rawLegs = router.findRoute(fromId, toId)
      if (!rawLegs) {
        return c.json(NotFound('NO_ROUTE', 'No route between these stations.'), 404)
      }

      // No criteria and no labels: findRoute produces neither, and a single
      // answer has nothing to be labelled against anyway.
      const plan = planJourney(rawLegs, null, [], context)
      const stations = await stationRepository.getByIds(plan.stationIds)
      const namer = stationNamer(stations)
      const journey = assembleJourney(plan, namer, context)

      const result: FareResult = {
        from: namer.ref(fromId),
        to: namer.ref(toId),
        legs: journey.legs,
        segments: journey.segments,
        totalFare: journey.totalFare,
        totalDistanceM: journey.totalDistanceM,
        transferCount: journey.transferCount
        // No `journeys`: this endpoint answers with one route, as it always has.
      }

      c.executionCtx.waitUntil(kvRepository.set(kvKey, result))

      return c.json(Ok(result), 200)
    } catch (error) {
      console.error(error)
      return c.json(Internal('DATABASE_ERROR', 'Can\'t connect to database, please try again later.'), 500)
    }
  }
)

export default app
