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

import type { LegTiming, RouteLeg, Tsundere } from '@commute/tsundere'
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
function timeJourney(journey: FareJourney, router: Tsundere, context: FareContext): FareJourney {
  const routeLegs = toRouteLegs(journey.legs)
  const timings = router.timeJourney(routeLegs, {
    departureS: secondsSinceLocalMidnight(context.departureAt),
    dayMask: dayMaskFor(context.departureAt)
  })

  const stamp = (seconds: number) => wibIsoString(atSecondsOfDay(context.departureAt, seconds))
  const legs = journey.legs.map((leg, index): FareResultLeg => {
    const timing: LegTiming | null = timings[index] ?? null
    if (leg.type !== 'RIDE' || !timing) return leg
    return { ...leg, departureAt: stamp(timing.departureS), arrivalAt: stamp(timing.arrivalS) }
  })

  const arrivalS = router.journeyArrival(routeLegs, timings)
  return { ...journey, legs, ...(arrivalS === null ? {} : { arrivalAt: stamp(arrivalS) }) }
}

/** Every journey in a trips answer, timed against the request's own clock. */
export function retimeTrips(result: TripResult, router: Tsundere, context: FareContext): TripResult {
  return { ...result, journeys: result.journeys.map(j => timeJourney(j, router, context)) }
}
