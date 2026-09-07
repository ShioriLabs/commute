/*
 * Departure times for a journey the search has already chosen.
 *
 * This runs AFTER `plan`, over materialised legs, and it never changes which
 * route comes back — only what time you catch each vehicle on it.
 *
 * That separation is the whole design, and it is a measurement rather than a
 * preference. Replanning 200 seeded rail pairs at 06:00, 09:00, 12:00, 15:00,
 * 18:00 and 21:00 returned the IDENTICAL route at all six hours for 162 of the
 * 162 pairs that route at all six — 100%, no exceptions. Service hours already
 * exclude the corridors that are shut, and nothing else in the criteria vector
 * moves with the clock. So which way you go is a stable fact and only which
 * vehicle you catch varies, which means the Pareto search needs no time axis to
 * answer the question riders are actually asking.
 *
 * Keeping it out of the search is worth real money. An `arrivalS` axis on
 * Criteria would widen the front, raise bag pressure, and lean on exactly the
 * eviction and termination arguments MAX_SAME_ROUND_REVISITS exists to catch —
 * all to return the same route it already returns.
 *
 * The times are also deliberately NOT cached with the journey: apps/api holds
 * an answer in KV for 20 hours, so a clock time baked into that body would be
 * wrong minutes later. The journey is the cacheable half and this is the
 * per-request half.
 */

import type { RouteLeg } from '../router'
import { DAY_S } from './service-hours'
import { nextTrip, type IndexedPattern, type Trip, type TripIndex } from './trips'

/**
 * Walking pace for the gap between two legs, in metres per second.
 *
 * 1.2 m/s is an ordinary unhurried walk. A modelled allowance, not a
 * measurement — the engine has no duration model at all (`edges.durationSeconds`
 * is null on every row), so this is the same kind of estimate `concourseWalkM`
 * already is, and it is kept here beside its one use rather than presented as
 * network data.
 *
 * It decides only whether a rider makes a given train. Being slightly generous
 * is the safe direction: quoting a connection they cannot catch is worse than
 * quoting the one after it.
 */
const WALK_PACE_MS = 1.2

/** Seconds to cross a transfer, from its measured distance. */
const walkSecondsFor = (distanceM: number) => Math.ceil(distanceM / WALK_PACE_MS)

/**
 * When one leg is boarded and left, or null when the timetable cannot say.
 *
 * Index-aligned with the journey's legs, so `timings[i]` describes `legs[i]`.
 * Null is the honest answer for a leg no trip covers, and — see below — for
 * every leg after one, because the clock is no longer known.
 *
 * Seconds since local midnight, and MAY EXCEED DAY_S on a journey that crosses
 * it. The caller converts to a wall clock; this package has no timezone.
 */
export interface LegTiming {
  departureS: number
  arrivalS: number
  /** The trip boarded, for tracing back to the feed. Never parsed here. */
  tripId: string
  /** Where that vehicle is signed for, when the feed says. See Trip.headsign. */
  headsign?: string
}

export interface ResolveDeparturesOptions {
  /** When the rider sets off, in seconds since local midnight. */
  departureS: number
  /**
   * Days to consider, as the same bitmask the trips carry. The engine never
   * interprets the bits; apps/api decides which one means Saturday.
   */
  dayMask: number
}

/*
 * Can this pattern carry the whole leg, and where does it board?
 *
 * A leg is a run of hops the search merged because they share a line code
 * (see materialise.ts) — which is not the same as sharing a VEHICLE. The
 * pattern has to serve every stop of that run, in order and consecutively, or
 * the "trip" this would report is really two, and its departure time would be a
 * promise about a train the rider is not on.
 *
 * Returns the boarding index, or -1.
 */
function boardingIndexFor(pattern: IndexedPattern, stationIds: readonly string[]): number {
  const start = pattern.stopIndex.get(stationIds[0]!)
  if (start === undefined) return -1
  if (start + stationIds.length > pattern.stationIds.length) return -1
  for (let i = 1; i < stationIds.length; i++) {
    if (pattern.stationIds[start + i] !== stationIds[i]) return -1
  }
  return start
}

/*
 * The time a rider is actually off the vehicle at `index`.
 *
 * `arrivalsS` where the feed records a real per-stop arrival, the departure
 * otherwise. KCI stores the TERMINUS arrival on every row of a trip, so the
 * generator drops those rather than let them read as per-stop times — and the
 * departure from the alighting stop is then the honest figure. Never subtract
 * one from the other to invent a dwell that was never measured.
 */
const alightTimeOf = (trip: Trip, index: number) =>
  trip.arrivalsS?.[index] ?? trip.departuresS[index]!

/**
 * Put clock times on a journey's legs, as far as the timetable honestly reaches.
 *
 * Walks the legs in order, carrying a running clock: board the first trip on a
 * covering pattern at or after it, ride to the alighting stop, and cross a
 * transfer at walking pace.
 *
 * The moment a ride leg cannot be timed, the clock stops being known — a rider
 * whose second leg has no timetable has no idea when they reach the third — so
 * every later leg is null too. Returning a plausible time there would be
 * inventing one, which is the single thing this file must not do.
 */
export function resolveDepartures(
  legs: readonly RouteLeg[],
  trips: TripIndex,
  { departureS, dayMask }: ResolveDeparturesOptions
): (LegTiming | null)[] {
  const timings: (LegTiming | null)[] = []
  let clockS: number | null = departureS

  for (const leg of legs) {
    if (leg.type === 'TRANSFER') {
      timings.push(null)
      if (clockS !== null) clockS += walkSecondsFor(leg.distanceM)
      continue
    }

    if (clockS === null) {
      timings.push(null)
      continue
    }

    /*
     * Only patterns on this leg's own line. A pattern that happens to serve the
     * same stops on another line is a different service, and boarding it would
     * report a vehicle the journey never said to take.
     */
    let best: { trip: Trip, boardAt: number, alightAt: number } | null = null
    for (const pattern of trips.byLine.get(leg.lineCode) ?? []) {
      const board = boardingIndexFor(pattern, leg.stationIds)
      if (board < 0) continue
      const trip = nextTrip(pattern, board, clockS, dayMask)
      if (!trip) continue
      const boardAt = trip.departuresS[board]!
      /*
       * Earliest departure wins across patterns. A stop is often served by a
       * full run and a short-turn of the same line, and the rider takes
       * whichever comes first that goes far enough — `boardingIndexFor` has
       * already established both go far enough.
       */
      if (best === null || boardAt < best.boardAt) {
        best = { trip, boardAt, alightAt: alightTimeOf(trip, board + leg.stationIds.length - 1) }
      }
    }

    if (best === null) {
      timings.push(null)
      clockS = null
      continue
    }

    timings.push({
      departureS: best.boardAt,
      arrivalS: best.alightAt,
      tripId: best.trip.id,
      ...(best.trip.headsign === undefined ? {} : { headsign: best.trip.headsign })
    })
    clockS = best.alightAt
  }

  return timings
}

/**
 * When the journey ends, or null unless every ride leg was timed.
 *
 * All-or-nothing on purpose. A total that skipped an untimed leg would be an
 * arrival time for a journey nobody can promise, and it would read as more
 * certain than the legs it was built from — the same reason a leg after an
 * untimed one reports nothing.
 */
export function journeyArrivalS(
  legs: readonly RouteLeg[],
  timings: readonly (LegTiming | null)[]
): number | null {
  let last: number | null = null
  for (let i = 0; i < legs.length; i++) {
    if (legs[i]!.type !== 'RIDE') continue
    const timing = timings[i]
    if (!timing) return null
    last = timing.arrivalS
  }
  return last
}

/** Seconds since local midnight as a same-day offset, for display. */
export const clockOf = (seconds: number) => ((seconds % DAY_S) + DAY_S) % DAY_S
