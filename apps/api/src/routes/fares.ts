import { Hono } from 'hono'
import { FareContext, Operator, PAYMENT_METHODS, PaymentMethod } from '@commute/constants'
import { Bindings } from 'app'
import { EdgeRepository } from 'db/repositories/edges'
import { assembleJourney, planJourney } from 'utils/fare-journey'
import { handleJourneyRequest, journeyCacheKey } from 'utils/journey-endpoint'
import { SERVICE_BREAKS, TOPOLOGY } from 'db/data/topology'
import { loadGraph, type LoadGraphInput, type ServiceWindow, type Tsundere, type WaitModel } from '@commute/tsundere'
import { HEADWAYS_S, STOP_HEADWAYS_S } from 'db/data/headways'
import { SERVICE_HOURS, type ServiceDay } from 'db/data/service-hours'
import { TRIP_PATTERNS } from 'db/data/trips'
import { airportExclusion } from 'utils/airport'
import { secondsSinceLocalMidnight, serviceDay } from 'utils/fare'
import { doc, pathParam, queryParam } from 'schemas/describe'
import { FareResultSchema, type FareResult } from '@commute/schemas'
import { memoize } from 'utils/memo'
import { plannerHeadways } from 'utils/observedHeadways'
import { observedHeadwaysEnabled } from 'utils/observedFlag'
import { DEFAULT_HEADWAY_S, expectedWaitS } from 'utils/tjWaits'

const app = new Hono<{ Bindings: Bindings }>()

// Graph inputs only change with deploys/reseeds; cache the loaded engine per
// isolate. Rebuilding it per request would re-read every edge and transfer row.
// Exported so /_internal/trips shares this instance rather than loading a second
// copy of the same graph into the same isolate.
let cachedRouter: Tsundere | null = null
export async function getRouter(d1: D1Database): Promise<Tsundere> {
  if (cachedRouter) return cachedRouter
  cachedRouter = routerFromInputs(await new EdgeRepository(d1).getGraphInputs())
  return cachedRouter
}

/*
 * The engine for a given set of graph rows, with everything else it is loaded
 * with taken from repo data. Split out of getRouter so the route regression
 * suite (routes/trips.regression.test.ts) builds its router from a snapshot the
 * same way production builds it from D1, rather than from a copy that can drift.
 */
export function routerFromInputs({ edges, transfers }: Pick<LoadGraphInput, 'edges' | 'transfers'>): Tsundere {
  // Service breaks are authored in (operator, station) codes; the graph works
  // in `${operator}-${station}` DB ids. tsundere treats node ids as opaque, so
  // this mapping stays here rather than in the engine.
  const serviceBreaks = SERVICE_BREAKS.map(b => ({
    lineCode: b.lineCode,
    viaStationId: `${b.operator}-${b.via}`,
    fromStationId: `${b.operator}-${b.from}`,
    toStationId: `${b.operator}-${b.to}`
  }))
  return loadGraph({
    edges,
    transfers,
    // Read by findRoutes only; /fares keeps the answer it has always given.
    serviceBreaks,
    // Read by findRoutes to price the expected wait per boarding, which is what
    // separates journeys that are otherwise equal on distance and changes.
    //
    // One map, two key shapes: `lineCode@stationId` wins where a stop has its own
    // measured value, `lineCode` is the fallback. The planner tries them in that
    // order, so the per-stop entries must not shadow a line key of the same name
    // (they cannot — `@` is not legal in a line code).
    headwaysS: new Map([...Object.entries(HEADWAYS_S), ...Object.entries(STOP_HEADWAYS_S)]),
    // When each line runs. A static property of the network, so it is loaded
    // with the graph; only the moment being asked about varies per request,
    // and that is findRoutes' `departureS`.
    serviceHours: serviceHoursMap(),
    /*
     * The timetable. Indexed at load beside the graph, and NOT READ BY THE
     * SEARCH YET — findRoutes is still headway-based. It is loaded now so the
     * data is exercised on the real network (and visible to /_internal health
     * checks) before anything depends on it. See docs/go-mode.md.
     */
    trips: TRIP_PATTERNS.map(pattern => ({
      lineCode: pattern.line,
      stationIds: pattern.stations,
      trips: pattern.trips.map(trip => ({
        id: trip.t,
        dayMask: trip.d,
        // Where the train is signed. A line code is not a service — from Cakung
        // line C runs trains to Kampung Bandan, to Angke and out to Cikarang —
        // and this is the only thing that tells two of its departures apart.
        headsign: trip.f,
        departuresS: trip.s,
        arrivalsS: trip.a
      }))
    }))
  })
}

/*
 * Per-line service windows, flattened for the day the caller is asking about.
 *
 * SERVICE_HOURS keys a line by day, with ALL where the window does not vary.
 * The planner wants one map, so the day is resolved here. Built once per
 * isolate per day rather than per request: three small maps, and the graph
 * memoisation above stays intact because none of this touches the graph.
 */
const serviceHoursCache = new Map<ServiceDay, Map<string, ServiceWindow>>()
function serviceHoursMap(day: ServiceDay = 'ALL'): Map<string, ServiceWindow> {
  return memoize(serviceHoursCache, day, () => {
    const resolved = new Map<string, ServiceWindow>()
    for (const [line, byDay] of Object.entries(SERVICE_HOURS)) {
      // Specific day first, then the every-day window. A line with neither is
      // left out, which leaves it always boardable.
      const window = (day === 'ALL' ? undefined : byDay[day]) ?? byDay.ALL
      if (window) resolved.set(line, window)
    }
    return resolved
  })
}

/*
 * Headways for a given day and hour of day.
 *
 * The schedule table for the day, with TransJakarta's observed values laid over
 * it for that hour (utils/observedHeadways.ts): where the model has a number it
 * wins, elsewhere the schedule value is scaled to the hour, and rail is left
 * alone. With the kill switch off this is exactly the schedule map.
 *
 * The hour is whole hours of the Jakarta clock. The journey cache key already
 * carries a 20-minute departure slot, so a cached answer can never straddle an
 * hour boundary.
 */
function headwaysFor(day: ServiceDay, hour: number, enabled: boolean): Map<string, number> {
  return plannerHeadways(day, hour, enabled)
}

const hourOf = (seconds: number) => Math.floor(seconds / 3600) % 24

/*
 * Every distinct moment a line opens, in seconds since local midnight, sorted.
 *
 * Small by construction — nine across the whole network (03:47, 03:50, 04:12,
 * 04:27, 05:00, 05:12, 05:18, 05:30, 05:58), because corridors share opening
 * times. That is what makes "when does this trip become possible" answerable by
 * re-planning at each candidate rather than by walking the clock minute by
 * minute.
 *
 * A window opening at 0 is a line that never closes, so it can never be the
 * reason a trip is unroutable and is left out.
 */
const openingTimesCache = new Map<ServiceDay, number[]>()
function openingTimes(day: ServiceDay): number[] {
  return memoize(openingTimesCache, day, () => {
    const opens = new Set<number>()
    for (const window of serviceHoursMap(day).values()) {
      if (window[0] !== 0) opens.add(window[0])
    }
    return [...opens].sort((a, b) => a - b)
  })
}

/**
 * The next moment this pair becomes routable, or null if it never does today.
 *
 * Re-runs the search at each opening after `departureS`, earliest first, and
 * returns the first that yields a journey. Bounded twice over: only openings
 * later today are tried, and never more than MAX_REOPEN_PROBES of them, so a
 * pair that is genuinely disconnected costs a handful of searches rather than
 * an unbounded scan.
 *
 * Deliberately does NOT wrap into tomorrow. "Come back at 05:00" is useful;
 * "come back at 05:00 the day after next" is a routing answer nobody asked for,
 * and a pair with no path at any hour should read as NO_ROUTE instead.
 */
const MAX_REOPEN_PROBES = 8
export function nextServiceAt(
  router: Tsundere,
  fromId: string,
  toId: string,
  context: FareContext,
  /*
   * Must match the exclusion the failed search used, or the probe answers a
   * different question than the one that came back empty — promising a 05:00
   * reopening on a corridor the rider has just said they will not board.
   */
  excludeLines?: ReadonlySet<string>,
  /*
   * The same place-equivalent endpoints the search used (utils/places.ts), for
   * the same reason as `excludeLines`.
   */
  endpoints?: { originIds: ReadonlySet<string>, targetIds: ReadonlySet<string> },
  /*
   * The observed-headway switch the failed search ran under. A request passes
   * its own captured value; the default is the isolate's last one.
   */
  observed: boolean = observedHeadwaysEnabled()
): { departureS: number, at: Date } | null {
  const day = serviceDay(context.departureAt)
  const from = secondsSinceLocalMidnight(context.departureAt)
  const candidates = openingTimes(day).filter(t => t > from).slice(0, MAX_REOPEN_PROBES)

  for (const departureS of candidates) {
    const found = router.findRoutes(fromId, toId, {
      departureS,
      serviceHours: serviceHoursMap(day),
      headwaysS: headwaysFor(day, hourOf(departureS), observed),
      excludeLines,
      ...endpoints
    })
    if (found.length > 0) {
      // Same calendar day, at the opening — the caller renders it in WIB.
      const at = new Date(context.departureAt)
      at.setUTCSeconds(at.getUTCSeconds() + (departureS - from))
      return { departureS, at }
    }
  }
  return null
}

/*
 * Line codes belonging to one operator, derived from the topology rather than
 * listed by hand so a new corridor is covered the day it is declared.
 *
 * Built lazily and memoised per isolate: the same reasoning as the graph, and
 * the same lifetime.
 */
const linesByOperator = new Map<string, ReadonlySet<string>>()
export function linesOf(operator: Operator): ReadonlySet<string> {
  const cached = linesByOperator.get(operator)
  if (cached) return cached
  const lines = new Set(TOPOLOGY.filter(t => t.operator === operator).map(t => t.lineCode))
  linesByOperator.set(operator, lines)
  return lines
}

/*
 * The search's wait model for one service day and hour (utils/tjWaits.ts):
 * bunched TransJakarta waits, pooled across lines on a shared stretch, and h/2
 * for everything else or with observed headways off. Memoised per isolate like
 * the headway maps it reads, and so are the waits inside it: the same few
 * thousand (set, stop) pairs come up on every search in that hour.
 */
const waitModels = new Map<string, WaitModel>()
function waitModelFor(day: ServiceDay, hour: number, observed: boolean): WaitModel {
  return memoize(waitModels, `${day}:${hour}:${observed}`, () => {
    const ctx = { day, clockS: hour * 3600, headways: headwaysFor(day, hour, observed), observed }
    const memo = new Map<string, number>()
    return (lines, stop, next) => {
      const key = `${stop}>${next}|${lines.join(',')}`
      let waitS = memo.get(key)
      if (waitS === undefined) {
        // With a fallback headway this only comes back empty for a headway of
        // zero, which no map holds; half the fallback then, never NaN.
        waitS = expectedWaitS(lines, stop, next, ctx, DEFAULT_HEADWAY_S) ?? DEFAULT_HEADWAY_S / 2
        memo.set(key, waitS)
      }
      return waitS
    }
  })
}

/** Planner options that depend on when the rider is travelling. */
export function timeOptions(context: FareContext, observed: boolean = observedHeadwaysEnabled()): {
  departureS: number
  serviceHours: Map<string, ServiceWindow>
  headwaysS: Map<string, number>
  waitS: WaitModel
} {
  const day = serviceDay(context.departureAt)
  const departureS = secondsSinceLocalMidnight(context.departureAt)
  return {
    departureS,
    serviceHours: serviceHoursMap(day),
    headwaysS: headwaysFor(day, hourOf(departureS), observed),
    waitS: waitModelFor(day, hourOf(departureS), observed)
  }
}

/**
 * What the TransJakarta estimates need for this request (utils/observedRuntimes.ts):
 * the service day, the same headways the search charged, and the day's service
 * windows. Built from the same memoised maps as timeOptions, and waited on
 * through the same model (utils/tjWaits.ts). Not the identical figure: the
 * estimate reads the bunching at the clock it reaches each stop rather than the
 * request's hour, takes the set of lines open then (excluded modes are not
 * applied, as the journey already chose its legs), and skips a line with no
 * headway where the search assumes the default.
 */
export function estimateInputs(context: FareContext, observed: boolean = observedHeadwaysEnabled()): {
  day: ServiceDay
  headways: Map<string, number>
  serviceHours: Map<string, ServiceWindow>
  observed: boolean
} {
  const day = serviceDay(context.departureAt)
  const { serviceHours, headwaysS } = timeOptions(context, observed)
  return { day, headways: headwaysS, serviceHours, observed }
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
  return journeyCacheKey('fares', fromId, toId, context, apiVersion)
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
  async c => handleJourneyRequest<FareResult>(c, getRouter, parseFareContext, {
    keyPrefix: 'fares',
    build: async ({ router, timing, context, fromId, toId, hydrate }) => {
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
      // KA Bandara only for airport journeys, same as /_internal/trips; for every
      // other pair this is the graph the endpoint answered from before line A
      // was loaded, so its answers do not move.
      const rawLegs = timing.measureSync('route', () => router.findRoute(fromId, toId, {
        excludeLines: airportExclusion(fromId, toId)
      }))
      if (!rawLegs) return null

      // No criteria and no labels: findRoute produces neither, and a single
      // answer has nothing to be labelled against anyway.
      const plan = timing.measureSync('plan', () => planJourney(rawLegs, null, [], context))
      const namer = await hydrate(plan.stationIds)
      const journey = timing.measureSync('assemble', () => assembleJourney(plan, namer, context))

      return {
        from: namer.ref(fromId),
        to: namer.ref(toId),
        legs: journey.legs,
        segments: journey.segments,
        totalFare: journey.totalFare,
        totalDistanceM: journey.totalDistanceM,
        transferCount: journey.transferCount
        // No `journeys`: this endpoint answers with one route, as it always has.
      }
    }
  })
)

export default app
