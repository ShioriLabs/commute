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
 */

import type { LegTiming, RouteLeg, Tsundere, WalkingPreference } from '@commute/tsundere'
import type { FareJourney, FareResultLeg, TripResult } from '@commute/schemas'
import { atSecondsOfDay, serviceDay, secondsSinceLocalMidnight, wibIsoString } from 'utils/fare'
import { DAY_MASK } from 'db/schemas/schedules'
import type { FareContext } from '@commute/constants'

/** The 3-bit mask the trips carry, for the day the rider is travelling. */
const dayMaskFor = (at: Date): number => DAY_MASK[serviceDay(at)]

/*
 * The wire leg, back in the shape the engine's resolver understands.
 *
 * Only the fields it reads: which line, and which stops in order. Rebuilding
 * this from the response rather than carrying engine legs through the cache is
 * what keeps the cached body free of anything request-specific.
 */
function toRouteLegs(legs: readonly FareResultLeg[]): RouteLeg[] {
  return legs.map((leg): RouteLeg => leg.type === 'RIDE'
    ? {
        type: 'RIDE',
        // The wire carries `operator:lineCode`; the engine wants the bare code.
        lineCode: leg.line.slice(leg.line.indexOf(':') + 1),
        operator: leg.operator,
        fromStationId: leg.from.id,
        toStationId: leg.to.id,
        stationIds: leg.stops.map(s => s.id),
        distanceM: leg.distanceM
      }
    : {
        type: 'TRANSFER',
        fromStationId: leg.from.id,
        toStationId: leg.to.id,
        distanceM: leg.distanceM,
        noTap: false
      })
}

/** One journey, with times on every leg the timetable actually covers. */
/*
 * How many boardings of one route to offer.
 *
 * A route is a way of getting there; a boarding is a train. From Cakung the
 * 08.11, the 08.22 and the 08.33 are all the same route and all real choices,
 * and showing only the first hides that the 08.22 arrives at the same 08.56 —
 * eleven fewer minutes on the platform for nothing.
 *
 * Three rather than more: a pair with two routes then lands six rows, which is
 * a list a rider can still read. Five would be closer to the reference apps and
 * would push genuinely different routes off the first screen.
 */
const BOARDINGS_PER_ROUTE = 3

/** One journey, timed for a specific boarding. Null when nothing runs. */
function timeOnce(
  journey: FareJourney,
  routeLegs: RouteLeg[],
  router: Tsundere,
  context: FareContext,
  afterS: number,
  walking?: WalkingPreference
): { journey: FareJourney, departureS: number, tripId: string } | null {
  const timings = router.timeJourney(routeLegs, {
    departureS: afterS,
    dayMask: dayMaskFor(context.departureAt),
    ...(walking === undefined ? {} : { walking })
  })
  const stamp = (seconds: number) => wibIsoString(atSecondsOfDay(context.departureAt, seconds))

  const legs = journey.legs.map((leg, index): FareResultLeg => {
    const timing: LegTiming | null = timings[index] ?? null
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
    return {
      ...leg,
      departureAt: stamp(timing.departureS),
      arrivalAt: stamp(timing.arrivalS),
      ...(timing.headsign === undefined ? {} : { headsign: timing.headsign })
    }
  })

  const arrivalS = router.journeyArrival(routeLegs, timings)
  const timed = { ...journey, legs, ...(arrivalS === null ? {} : { arrivalAt: stamp(arrivalS) }) }

  const first = timings.find(t => t)
  return first ? { journey: timed, departureS: first.departureS, tripId: first.tripId } : null
}

/**
 * Every boarding of one route worth offering, earliest first.
 *
 * An untimed route yields exactly one row: there are no departures to walk, and
 * three identical cards with no clock on them would be noise rather than
 * choice. That is the TransJakarta case and the unchained-rail case both.
 */
function boardingsOf(
  journey: FareJourney,
  router: Tsundere,
  context: FareContext,
  walking?: WalkingPreference
): FareJourney[] {
  const routeLegs = toRouteLegs(journey.legs)
  const rows: FareJourney[] = []
  const seenTrips = new Set<string>()
  let afterS = secondsSinceLocalMidnight(context.departureAt)

  for (let i = 0; i < BOARDINGS_PER_ROUTE; i++) {
    const timed = timeOnce(journey, routeLegs, router, context, afterS, walking)
    // No timetable at all, or the service is done for the day. Either way there
    // is nothing further to offer, so stop rather than pad the list.
    if (!timed) break
    /*
     * Two patterns on one line can resolve to the same train — a full run and a
     * short-turn both serving the boarding stop. That is one vehicle and must
     * be one row.
     */
    if (!seenTrips.has(timed.tripId)) {
      seenTrips.add(timed.tripId)
      rows.push(timed.journey)
    }
    afterS = timed.departureS + 60
  }

  // Untimed: one row, exactly as before this existed.
  return rows.length > 0 ? rows : [journey]
}

/** Every journey in a trips answer, timed against the request's own clock. */
export function retimeTrips(
  result: TripResult,
  router: Tsundere,
  context: FareContext,
  walking?: WalkingPreference
): TripResult {
  const rows = result.journeys.flatMap(j => boardingsOf(j, router, context, walking))
  return { ...result, journeys: relabel(byArrival(rows)) }
}

/*
 * Reassign the badges across the expanded set.
 *
 * The engine labels the journey that UNIQUELY wins an axis, and declines to
 * label a lone one — a badge is a comparison, so "Termurah" means nothing
 * without the option it beats. Expanding two journeys into six rows breaks that
 * outright: three rows of one route share a fare, so three cards would read
 * "Termurah" and tell a rider nothing.
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
   */
  const routeKey = (j: FareJourney) => j.legs
    .map(l => (l.type === 'RIDE' ? `${l.line}:${l.from.id}>${l.to.id}` : `~${l.to.id}`))
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
 * Exported for its own tests: the all-or-nothing rule and the stable tie-break
 * are the parts worth pinning, and reaching them through retimeTrips would mean
 * standing up a whole graph to assert an ordering.
 */
export function byArrival(journeys: FareJourney[]): FareJourney[] {
  if (journeys.length < 2) return journeys
  const timed = journeys.filter(j => j.arrivalAt !== undefined)
  const untimed = journeys.filter(j => j.arrivalAt === undefined)
  if (timed.length < 2) return journeys
  return [
    ...[...timed].sort((a, b) => Date.parse(a.arrivalAt!) - Date.parse(b.arrivalAt!)),
    ...untimed
  ]
}
