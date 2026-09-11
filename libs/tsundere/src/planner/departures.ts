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
import type { WalkingPreference } from './criteria'
import { GATED_TRANSFER_WALK_M, PAID_ZONE_TRANSFER_WALK_M } from './plan'
import { DAY_S } from './service-hours'
import { nextTrip, type IndexedPattern, type Trip, type TripIndex } from './trips'

/**
 * Walking pace for the gap between two legs, in metres per second.
 *
 * 1.2 m/s is an ordinary unhurried walk, and stays the default so an unstated
 * preference times exactly as it did before this table existed. A modelled
 * allowance, not a measurement — the engine has no duration model at all
 * (`edges.durationSeconds` is null on every row), so this is the same kind of
 * estimate `concourseWalkM` already is, and it is kept here beside its one use
 * rather than presented as network data.
 *
 * It decides only whether a rider makes a given train. Being slightly generous
 * is the safe direction: quoting a connection they cannot catch is worse than
 * quoting the one after it.
 *
 * NOT `WALKING_WEIGHTS` from criteria.ts, which are comparison multipliers on
 * the walk axis and nothing to do with speed — dividing this pace by them would
 * put AVOID at 0.15 m/s, a pace no one walks. AVOID matches SLOW here because it
 * is a preference about WHETHER to walk, not about how fast a rider does.
 */
const WALK_PACE_MS: Record<WalkingPreference, number> = {
  BRISK: 1.5,
  AVERAGE: 1.2,
  SLOW: 0.9,
  AVOID: 0.9
}

/** Seconds to cross a distance on foot, at the rider's own pace. */
const walkSecondsAt = (distanceM: number, paceMs: number) => Math.ceil(distanceM / paceMs)

/*
 * No change takes less than a minute, however fast the rider walks.
 *
 * The pace calculation below can dip under one on a short hop — 100m at BRISK
 * is 67s — and a sub-minute connection is not one anybody makes: the doors have
 * to open, the platform has to clear, and the next train has to still be there.
 * A floor rather than a larger distance, because the reason it cannot go lower
 * has nothing to do with how far the rider walks.
 */
const MIN_CHANGE_S = 60

/*
 * The in-station time a change takes, over and above any measured walk.
 *
 * Every interchange costs something the timetable does not record: off the
 * train, along the platform, and back to a door. `resolveDepartures` used to
 * charge nothing for it, so a change read as instantaneous — a rider could
 * "catch" a train departing the same second they alighted, and every journey
 * with a change came out short.
 *
 * Taken from the distances `plan.ts` already models rather than invented here:
 * PAID_ZONE_TRANSFER_WALK_M is the circulation a change inside one paid zone
 * costs, and GATED_TRANSFER_WALK_M adds the gate line on top. The search has
 * charged these as `concourseWalkM` since it shipped; this is the same
 * allowance finally reaching the clock.
 *
 * Applied as a FLOOR on a measured walk, never added to it. A surveyed 400m
 * transfer already includes the concourse it crosses, so adding the allowance
 * would bill the rider for it twice; the floor only catches the rows where the
 * measured figure is too small to be real — above all `distanceM = 0`, which in
 * this repo means UNMEASURED and never "no walk at all".
 */
const changeSecondsAt = (paceMs: number, gated: boolean) =>
  Math.max(
    walkSecondsAt(gated ? GATED_TRANSFER_WALK_M : PAID_ZONE_TRANSFER_WALK_M, paceMs),
    MIN_CHANGE_S
  )

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
  /**
   * How fast this rider crosses a station, which decides which connections they
   * make. Optional, defaulting to AVERAGE, so every existing caller keeps the
   * timings it had.
   *
   * The same preference `weightsForWalking` takes, and the only place in the
   * engine where it means a SPEED rather than a ranking — see WALK_PACE_MS.
   */
  walking?: WalkingPreference
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
  { departureS, dayMask, walking = 'AVERAGE' }: ResolveDeparturesOptions
): (LegTiming | null)[] {
  const timings: (LegTiming | null)[] = []
  let clockS: number | null = departureS
  const paceMs = WALK_PACE_MS[walking]
  /*
   * Whether the leg just handled was a ride, so the next ride knows it is a
   * CHANGE rather than the start of the journey. Boarding the first vehicle
   * costs no change time — the rider is already standing on the platform.
   */
  let rodePrevious = false

  for (const leg of legs) {
    if (leg.type === 'TRANSFER') {
      timings.push(null)
      if (clockS !== null) {
        /*
         * The measured walk, or the in-station allowance where the measurement
         * is too small to be real. `noTap` stays inside the paid zone, so it
         * skips the gate line the allowance otherwise includes.
         */
        clockS += Math.max(
          walkSecondsAt(leg.distanceM, paceMs),
          changeSecondsAt(paceMs, !leg.noTap)
        )
      }
      rodePrevious = false
      continue
    }

    if (clockS === null) {
      timings.push(null)
      continue
    }

    /*
     * Two rides with no transfer between them is a change of vehicle at one
     * station — a different line off the same platform, or a service break
     * where the line code carries on but the train does not. `hopsToLegs` emits
     * no TRANSFER leg for either, so this is the only place that time can be
     * charged, and without it the rider "catches" a train leaving the instant
     * they step off the last one.
     */
    if (rodePrevious) clockS += changeSecondsAt(paceMs, false)

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
      rodePrevious = false
      continue
    }

    timings.push({
      departureS: best.boardAt,
      arrivalS: best.alightAt,
      tripId: best.trip.id,
      ...(best.trip.headsign === undefined ? {} : { headsign: best.trip.headsign })
    })
    clockS = best.alightAt
    rodePrevious = true
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
