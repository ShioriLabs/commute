/*
 * Clock times, applied to a finished answer on its way to the rider.
 *
 * Deliberately separate from planJourney/assembleJourney, which build the body
 * that gets CACHED. The route a search returns does not move during the day —
 * measured 2026-09-07, 162 of 162 rail pairs returned the identical route at
 * 06:00, 09:00, 12:00, 15:00, 18:00 and 21:00 — so the journey is cacheable for
 * its full 20 hours, while "the 07:14 train" is only true for the moment asked
 * about. Splitting them is what lets both be right at once.
 *
 * So this runs on the way OUT, on the cache-hit path as well as the miss path,
 * and it must never run before the KV write. See `retime` in journey-endpoint.
 *
 * The same pass adds `estimate` to journeys with a TransJakarta ride: observed
 * run times and expected waits (utils/observedRuntimes.ts) give a probable
 * duration where the timetable gives none. Estimates never become leg times,
 * which every client reads as timetable facts; and like the times they depend
 * on the request's clock, so they too stay out of the cached body.
 */

import type { LegTiming, RouteLeg, Tsundere, WalkingPreference } from '@commute/tsundere'
import type { FareJourney, FareJourneyDeparture, FareResultLeg, TripResult } from '@commute/schemas'
import { atSecondsOfDay, serviceDay, secondsSinceLocalMidnight, wibIsoString } from 'utils/fare'
import { DAY_MASK } from 'db/schemas/schedules'
import { SEPARATELY_GATED_LINES, type FareContext } from '@commute/constants'
import { lineCodeOf } from 'utils/ids'
import { hopsOf } from 'utils/merge-walks'
import type { RuntimesMode } from 'utils/observedFlag'
import { estimateTjLeg, type RuntimeStatistic, type TjEstimateInputs } from 'utils/observedRuntimes'

/** The 3-bit mask the trips carry, for the day the rider is travelling. */
const dayMaskFor = (at: Date): number => DAY_MASK[serviceDay(at)]

// The engine keys lines by bare code; SEPARATELY_GATED_LINES is `operator:code`.
const GATED_LINE_CODES: ReadonlySet<string> = new Set([...SEPARATELY_GATED_LINES].map(key => key.split(':')[1]!))

/*
 * The wire leg, back in the shape the engine's resolver understands.
 *
 * Only the fields it reads: which line, and which stops in order. Rebuilding
 * this from the response rather than carrying engine legs through the cache is
 * what keeps the cached body free of anything request-specific.
 */
/** The engine's legs for a wire journey, and where each wire leg landed among them. */
interface EngineRoute {
  legs: RouteLeg[]
  /** `engineIndexOf[i]` is the engine leg wire leg `i` became (its first hop, for a merged walk). */
  engineIndexOf: number[]
}

export function toRouteLegs(legs: readonly FareResultLeg[]): EngineRoute {
  const route: EngineRoute = { legs: [], engineIndexOf: [] }
  for (const leg of legs) {
    route.engineIndexOf.push(route.legs.length)
    if (leg.type === 'RIDE') {
      route.legs.push({
        type: 'RIDE',
        // The wire carries `operator:lineCode`; the engine wants the bare code.
        lineCode: lineCodeOf(leg.line),
        operator: leg.operator,
        fromStationId: leg.from.id,
        toStationId: leg.to.id,
        stationIds: leg.stops.map(s => s.id),
        distanceM: leg.distanceM
      })
      continue
    }
    /*
     * A merged walk is timed as the hops it was made of, so each still pays
     * the engine's change floor — see merge-walks.ts. The station ids in
     * between are not kept; the timing never reads them, only distance.
     */
    for (const distanceM of hopsOf(leg) ?? [leg.distanceM]) {
      route.legs.push({ type: 'TRANSFER', fromStationId: leg.from.id, toStationId: leg.to.id, distanceM, noTap: false })
    }
  }
  return route
}

/*
 * How far ahead a route's other boardings are offered, and how many at most.
 *
 * A route is a way of getting there; a boarding is a train. From Cakung the
 * 08.11, the 08.22 and the 08.33 are all the same route and all real choices,
 * so the card names the next ones after its own — but as times on that card,
 * not as cards of their own, which used to push genuinely different routes off
 * the first screen. An hour is the horizon a rider plans a departure in; the
 * cap only matters on a trunk running every few minutes.
 */
const MORE_WINDOW_S = 3600
const MAX_MORE_DEPARTURES = 8

/*
 * Trains listed under each timed leg, the caught one included: the train the
 * card is built on and the three after it, which is what a rider glances at
 * when they are about to miss one.
 */
const DEPARTURES_PER_LEG = 4

/** One journey, timed for a specific boarding. Null when nothing runs. */
function timeOnce(
  journey: FareJourney,
  route: EngineRoute,
  router: Tsundere,
  context: FareContext,
  afterS: number,
  walking?: WalkingPreference
): { journey: FareJourney, departureS: number, arrivalS: number | null, tripId: string } | null {
  const timings = router.timeJourney(route.legs, {
    departureS: afterS,
    dayMask: dayMaskFor(context.departureAt),
    gatedLines: GATED_LINE_CODES,
    upcomingPerLeg: DEPARTURES_PER_LEG,
    ...(walking === undefined ? {} : { walking })
  })
  const stamp = (seconds: number) => wibIsoString(atSecondsOfDay(context.departureAt, seconds))

  const legs = journey.legs.map((leg, index): FareResultLeg => {
    const timing: LegTiming | null = timings[route.engineIndexOf[index]!] ?? null
    if (leg.type !== 'RIDE' || !timing) return leg
    /*
     * The boarded train's own headsign wins over the one planJourney derived.
     *
     * That derivation walks the line topology, which cannot see which vehicle
     * this is: from Cakung every westbound leg came out "Angke via Manggarai"
     * whichever of the line's three destinations the rider was actually on.
     * Where a trip is known its `boundFor` is the fact, and the walk stays the
     * fallback for the legs no timetable reaches (all of TransJakarta, and the
     * rail trips whose stop lists have gaps).
     *
     * Applied here rather than in planJourney because it belongs to the
     * per-request half, exactly like the two stamps beside it — the cached body
     * must keep the derivation, or one rider's train is served to the next.
     */
    /*
     * The line of the train actually caught. On a trunk two lines share the
     * engine boards whichever leaves first, so a leg the search named BK can be
     * ridden on a CB train, and the card must show the one the rider boards.
     * Per-request like the headsign: the cached body keeps the search's line.
     */
    const prefix = leg.line.slice(0, leg.line.indexOf(':') + 1)
    const boardedLine = timing.lineCode === undefined ? leg.line : `${prefix}${timing.lineCode}`
    const upcoming = timing.upcoming?.map(departure => ({
      departureAt: stamp(departure.departureS),
      arrivalAt: stamp(departure.arrivalS),
      tripId: departure.tripId,
      line: `${prefix}${departure.lineCode}`,
      ...(departure.headsign === undefined ? {} : { headsign: departure.headsign })
    }))
    return {
      ...leg,
      ...(boardedLine === leg.line ? {} : { line: boardedLine }),
      departureAt: stamp(timing.departureS),
      arrivalAt: stamp(timing.arrivalS),
      // Per-request for the same reason: the times at each stop and the trip's
      // identity belong to the vehicle caught, not to the cached route.
      stopTimes: timing.stopsS.map(stamp),
      tripId: timing.tripId,
      // The engine's own change allowance into this leg, so a client re-timing
      // a later train applies the same rule it would. Per-request: it depends
      // on the rider's walking pace.
      ...(timing.changeBeforeS === undefined ? {} : { minChangeS: timing.changeBeforeS }),
      ...(timing.headsign === undefined ? {} : { headsign: timing.headsign }),
      // Per-request like the stamps: whether this is the last train depends on
      // which train was caught, never on the cached route.
      ...(timing.lastOfDay ? { lastService: true as const } : {}),
      ...(upcoming === undefined ? {} : { upcomingDepartures: upcoming })
    }
  })

  const arrivalS = router.journeyArrival(route.legs, timings)
  const timed = { ...journey, legs, ...(arrivalS === null ? {} : { arrivalAt: stamp(arrivalS) }) }

  const first = timings.find(t => t)
  return first ? { journey: timed, departureS: first.departureS, arrivalS, tripId: first.tripId } : null
}

/**
 * One route, as the card it is offered on: its best boarding, with the route's
 * other boardings in the next hour carried along as `moreDepartures`.
 *
 * An untimed route comes back unchanged: there are no departures to walk. That
 * is the TransJakarta case and the unchained-rail case both.
 */
function boardingsOf(
  journey: FareJourney,
  router: Tsundere,
  context: FareContext,
  walking?: WalkingPreference
): FareJourney {
  const route = toRouteLegs(journey.legs)
  const boardings: NonNullable<ReturnType<typeof timeOnce>>[] = []
  const seenTrips = new Set<string>()
  const atS = secondsSinceLocalMidnight(context.departureAt)
  let afterS = atS

  while (boardings.length <= MAX_MORE_DEPARTURES) {
    const timed = timeOnce(journey, route, router, context, afterS, walking)
    // No timetable at all, or the service is done for the day. Either way there
    // is nothing further to offer, so stop rather than pad the list.
    if (!timed) break
    // The first boarding is always offered, however far off; the rest only
    // inside the window.
    if (boardings.length > 0 && timed.departureS >= atS + MORE_WINDOW_S) break
    /*
     * Two patterns on one line can resolve to the same train — a full run and a
     * short-turn both serving the boarding stop. That is one vehicle and must
     * be offered once.
     */
    if (!seenTrips.has(timed.tripId)) {
      seenTrips.add(timed.tripId)
      boardings.push(timed)
    }
    afterS = timed.departureS + 60
  }

  /*
   * A boarding that leaves earlier and arrives no sooner than a later one is
   * only a longer wait on the platform — the 08.11 and the 08.22 that both
   * reach Rasuna Said at 08.56 — so it is never offered. Only judged where both
   * arrivals are known; on a rail-into-TransJakarta route neither is, and every
   * boarding stays a real choice.
   */
  const offered = boardings.filter((boarding, i) => boarding.arrivalS === null
    || !boardings.slice(i + 1).some(later => later.arrivalS !== null && later.arrivalS <= boarding.arrivalS!))

  const [row, ...more] = offered
  if (row) {
    return more.length === 0
      ? row.journey
      : { ...row.journey, moreDepartures: more.map(boarding => departureOf(boarding, context)) }
  }

  /*
   * Nothing left tonight, or never timed at all? The first boarding of the
   * next service day tells the two apart: a route the timetable covers has
   * one, and the rider is told when it starts again instead of being offered
   * an untimed row that looks rideable. A route it never covers still comes
   * back as the one untimed row, exactly as before this existed.
   */
  const tomorrow = nextServiceDay(context)
  const resumes = timeOnce(journey, route, router, tomorrow, SERVICE_DAY_START_S, walking)
  return resumes
    ? { ...journey, resumesAt: wibIsoString(atSecondsOfDay(tomorrow.departureAt, resumes.departureS)) }
    : journey
}

/*
 * A boarding as one of `moreDepartures`: when its first vehicle leaves, and
 * when the route lands if every leg is timed.
 */
function departureOf(
  { journey, departureS }: NonNullable<ReturnType<typeof timeOnce>>,
  context: FareContext
): FareJourneyDeparture {
  return {
    departureAt: wibIsoString(atSecondsOfDay(context.departureAt, departureS)),
    ...(journey.arrivalAt === undefined ? {} : { arrivalAt: journey.arrivalAt })
  }
}

/*
 * The service day turns over at 03:00, the same rollover the web's boards use:
 * trips after midnight belong to the night before, and the first trains run
 * from around 04:00.
 */
const SERVICE_DAY_START_S = 3 * 3600

/*
 * The context at the start of the next service day. Before 03:00 that is this
 * calendar day's morning; after, tomorrow's. Carrying a date rather than only
 * seconds is what gives the probe the right day mask, so a Friday night asks
 * Saturday's timetable.
 */
function nextServiceDay(context: FareContext): FareContext {
  const nowS = secondsSinceLocalMidnight(context.departureAt)
  const startS = nowS < SERVICE_DAY_START_S ? SERVICE_DAY_START_S : SERVICE_DAY_START_S + 24 * 3600
  return { ...context, departureAt: atSecondsOfDay(context.departureAt, startS) }
}

/*
 * How much earlier an estimated arrival must be to put a journey ahead of one
 * the engine ranked higher (byArrival). Closer than this, the engine's order
 * (fewer boardings, less walking) decides. The estimate's own error is minutes,
 * and with no margin most of what sort mode changed was one bus route
 * overtaking another on a minute or two (`ab:estimated-order`, 2026-10-19).
 *
 * A margin rather than the 5-minute rounding it replaced: rounding tied any two
 * arrivals that happened to fall in one band, up to five minutes apart, and
 * split ones a minute apart across a band edge. From Sudirman at 12:00 it tied
 * walk 560 m + 13E (~12:22) with Galunggung + 6 (~12:17) and kept the engine's
 * pick of the slower one on top.
 */
export const ESTIMATE_OVERTAKE_S = 180

/** What retimeTrips needs to estimate TransJakarta legs, per request. */
export interface EstimateOptions extends Omit<TjEstimateInputs, 'statistic'> {
  mode: RuntimesMode
  /** The statistic the sort mode orders by; `estimate` itself is always the median. */
  sortStatistic?: RuntimeStatistic
}

/**
 * When a journey with a TransJakarta ride probably arrives, in seconds since
 * local midnight, or null. Only for a journey the timetable cannot finish
 * (`arrivalAt` absent); see Tsundere.estimateJourney for why a leg can still
 * defeat it (a closed line, a last train the estimated clock misses).
 */
function estimatedArrivalS(
  route: EngineRoute,
  router: Tsundere,
  context: FareContext,
  walking: WalkingPreference | undefined,
  inputs: TjEstimateInputs
): { arrivalS: number, rideS: (number | null)[] } | null {
  return router.estimateJourney(route.legs, {
    departureS: secondsSinceLocalMidnight(context.departureAt),
    dayMask: dayMaskFor(context.departureAt),
    gatedLines: GATED_LINE_CODES,
    ...(walking === undefined ? {} : { walking }),
    estimateUntimed: (leg, atS) => estimateTjLeg(leg, atS, inputs)
  })
}

const hasTjRide = (journey: FareJourney) => journey.legs.some(l => l.type === 'RIDE' && l.operator === 'TJ')

/**
 * The journey with `estimate` attached where one can be made, plus the arrival
 * the sort mode should order it by. Untouched (and no sort key) otherwise.
 */
function withEstimate(
  journey: FareJourney,
  router: Tsundere,
  context: FareContext,
  walking: WalkingPreference | undefined,
  options: EstimateOptions
): { journey: FareJourney, sortArrivalS: number | null } {
  if (journey.arrivalAt !== undefined || !hasTjRide(journey)) return { journey, sortArrivalS: null }
  const route = toRouteLegs(journey.legs)
  const median = estimatedArrivalS(route, router, context, walking, { ...options, statistic: 'median' })
  if (!median) return { journey, sortArrivalS: null }
  const atS = secondsSinceLocalMidnight(context.departureAt)
  // Back onto the wire legs: a merged walk spans several engine legs, never a ride.
  const rideS = journey.legs.map((leg, i) => (leg.type === 'RIDE' ? median.rideS[route.engineIndexOf[i]!] ?? null : null))
  const sortS = options.sortStatistic === 'p75'
    ? estimatedArrivalS(route, router, context, walking, { ...options, statistic: 'p75' })?.arrivalS ?? null
    : median.arrivalS
  const sortArrivalS = sortS
  /*
   * Where a timed ride opens the journey, the card counts from that boarding,
   * as it does on a fully timed one; the client cannot recover `at` itself
   * through the edge cache. A journey opening on a bus counts from `at`, so
   * the expected wait at the first halte stays in the figure.
   */
  const firstRide = journey.legs.find(leg => leg.type === 'RIDE')
  const fromS = firstRide?.type === 'RIDE' && firstRide.departureAt
    ? Math.max(0, Math.round((Date.parse(firstRide.departureAt) - context.departureAt.getTime()) / 1000))
    : 0
  return { journey: { ...journey, estimate: { durationS: median.arrivalS - atS, fromS, rideS } }, sortArrivalS }
}

/** Every journey in a trips answer, timed against the request's own clock. */
export function retimeTrips(
  result: TripResult,
  router: Tsundere,
  context: FareContext,
  walking?: WalkingPreference,
  estimates?: EstimateOptions
): TripResult {
  const rows = result.journeys.map(j => boardingsOf(j, router, context, walking))
  if (!estimates || estimates.mode === 'off') return { ...result, journeys: relabel(byArrival(rows)) }

  const estimated = rows.map(row => withEstimate(row, router, context, walking, estimates))
  const journeys = estimated.map(e => e.journey)
  if (estimates.mode !== 'sort') return { ...result, journeys: relabel(byArrival(journeys)) }

  const sortArrival = new Map<FareJourney, number>()
  const base = context.departureAt.getTime() - secondsSinceLocalMidnight(context.departureAt) * 1000
  estimated.forEach((e) => {
    if (e.sortArrivalS !== null) sortArrival.set(e.journey, base + e.sortArrivalS * 1000)
  })
  return { ...result, journeys: relabel(byArrival(journeys, j => sortArrival.get(j))) }
}

/*
 * Reassign the badges across the timed set.
 *
 * The engine labels the journey that UNIQUELY wins an axis, and declines to
 * label a lone one — a badge is a comparison, so "Termurah" means nothing
 * without the option it beats. Two of its journeys can still be one route to a
 * rider — the same stations on either line of a shared trunk — and two cards of
 * one route share a fare, so both would read "Termurah" and tell a rider
 * nothing.
 *
 * So the engine's labels are dropped and recomputed here, keeping its rule
 * exactly — a tie means nobody wins.
 *
 * Compared per ROUTE rather than per row, which is the part that matters. Three
 * boardings of one route share its fare and its walk, so comparing rows would
 * tie every axis against itself and award nothing at all. The question a badge
 * answers is "which way is cheapest", not "which train", so routes are ranked
 * and the winner's badge goes on its earliest row.
 *
 * Only the axes that survive the wire are comparable: `waitS` never crosses it
 * (see the schema's note on why), so SHORTEST_WAIT cannot be recomputed and is
 * dropped rather than guessed at.
 */
function relabel(journeys: FareJourney[]): FareJourney[] {
  const stripped = journeys.map(j => ({ ...j, labels: [] as FareJourney['labels'] }))
  if (stripped.length < 2) return stripped

  /*
   * One representative row per route — the first, which after the arrival sort
   * is its soonest usable boarding. `routeKey` is the leg shape, so two
   * boardings of one route collapse and two genuinely different routes do not.
   * Keyed on the operator rather than the line: a boarding on a shared trunk
   * may carry the other line's code (see timeOnce) and is still the same route.
   */
  const routeKey = (j: FareJourney) => j.legs
    .map(l => (l.type === 'RIDE' ? `${l.operator}:${l.from.id}>${l.to.id}` : `~${l.to.id}`))
    .join('|')
  const firstOfRoute = new Map<string, number>()
  stripped.forEach((j, i) => {
    const key = routeKey(j)
    if (!firstOfRoute.has(key)) firstOfRoute.set(key, i)
  })
  const representatives = [...firstOfRoute.values()]
  if (representatives.length < 2) return stripped

  /** Index of the sole minimum, or -1 when nothing wins outright. */
  const winner = (values: (number | null)[]): number => {
    let bestIndex = -1
    let best = Infinity
    let tied = false
    for (let i = 0; i < values.length; i++) {
      const value = values[i]
      if (value === null || value === undefined) continue
      if (value < best) {
        best = value
        bestIndex = i
        tied = false
      } else if (value === best) {
        tied = true
      }
    }
    return tied ? -1 : bestIndex
  }

  // `winner` indexes into `representatives`, so map back to the row it names.
  const assign = (index: number, label: FareJourney['labels'][number]) => {
    if (index >= 0) stripped[representatives[index]!]!.labels.push(label)
  }
  const axis = (read: (j: FareJourney) => number | null) =>
    representatives.map(i => read(stripped[i]!))

  assign(winner(axis(j => j.boardings)), 'FEWEST_CHANGES')
  assign(winner(axis(j => j.walkDistanceM)), 'LEAST_WALKING')
  assign(winner(axis(j => j.totalFare)), 'CHEAPEST')

  return stripped
}

/*
 * Earliest arrival first, once every journey has one.
 *
 * The engine ranks on distance, walking, boardings and wait, and cannot rank on
 * arrival because it has no clock — so its order and the times on the cards can
 * disagree. Measured over 1200 seeded rail pairs: on **10.6% of the fully-timed
 * pairs with more than one journey the top card was not the earliest arrival**,
 * by a mean of 7 minutes. MRTJ-STB -> KCI-CSK is the clearest case, where two
 * journeys share their lines and their 08.04 departure but one reaches Cisauk
 * at 09.00 against 09.10, and walks 90m against 200m — better on both axes and
 * still listed second.
 *
 * Sorting here rather than in the engine keeps arrival out of the Pareto search
 * entirely, which is what stops the front widening and the bag-eviction and
 * termination arguments in plan.ts from having to be re-argued.
 *
 * Timed rows sort among themselves; untimed ones keep the engine's ranking and
 * follow after. A mixed list is now the normal case rather than the exception —
 * a TransJakarta route has no arrival to sort on while the rail route beside it
 * does — so refusing to sort at all whenever one row is untimed would leave the
 * common case unordered. What must not happen is interleaving the two rules,
 * because then neither half's position means anything; keeping the untimed tail
 * whole and behind is what avoids that.
 *
 * A stable sort, so journeys that arrive at the same minute keep the engine's
 * ranking between them — that is still the better tie-break, and it keeps the
 * order deterministic for a `selectedIndex` the map holds across a render.
 *
 * Labels are untouched: the engine assigns them by comparison, not by position,
 * so `Termurah` stays on the cheapest card wherever it lands.
 *
 * With `estimatedArrivalMs` (the observed-runtimes sort mode), a journey with
 * no timetable arrival but an estimated one joins the timed set on that
 * estimate. That is still one rule, arrival, applied to every row that has one;
 * rows with neither stay in the untimed tail. Without it, exactly as before.
 *
 * Where an estimate is involved, arriving earlier is not enough on its own: a
 * journey moves ahead of one the engine ranked higher only when it arrives
 * ESTIMATE_OVERTAKE_S earlier. Between two timetabled journeys the margin is
 * zero, so an all-rail answer sorts exactly as it always has. The order is
 * built by repeatedly taking the earliest remaining arrival and, in its place,
 * the first journey in engine order that it does not beat by the margin. That
 * is deterministic, which a pairwise "close enough" comparator in a sort is not.
 *
 * Exported for its own tests: the all-or-nothing rule and the stable tie-break
 * are the parts worth pinning, and reaching them through retimeTrips would mean
 * standing up a whole graph to assert an ordering.
 */
export function byArrival(
  journeys: FareJourney[],
  estimatedArrivalMs?: (journey: FareJourney) => number | undefined
): FareJourney[] {
  if (journeys.length < 2) return journeys
  const arrivalOf = (j: FareJourney) => (j.arrivalAt !== undefined ? Date.parse(j.arrivalAt) : estimatedArrivalMs?.(j))
  const timed = journeys.filter(j => arrivalOf(j) !== undefined)
  const untimed = journeys.filter(j => arrivalOf(j) === undefined)
  if (timed.length < 2) return journeys
  if (!estimatedArrivalMs) {
    return [
      ...[...timed].sort((a, b) => arrivalOf(a)! - arrivalOf(b)!),
      ...untimed
    ]
  }

  const marginMs = (a: FareJourney, b: FareJourney) =>
    (a.arrivalAt === undefined || b.arrivalAt === undefined ? ESTIMATE_OVERTAKE_S * 1000 : 0)
  const remaining = [...timed]
  const ordered: FareJourney[] = []
  while (remaining.length > 0) {
    let lead = remaining[0]!
    for (const j of remaining) if (arrivalOf(j)! < arrivalOf(lead)!) lead = j
    // The earliest arrival qualifies for its own place, so this always finds one.
    const next = remaining.findIndex((j) => {
      const behind = arrivalOf(j)! - arrivalOf(lead)!
      return behind <= 0 || behind < marginMs(j, lead)
    })
    ordered.push(...remaining.splice(next, 1))
  }
  return [...ordered, ...untimed]
}
