import type { FareJourney, FareLegDeparture, FareResultLeg } from '@commute/schemas'

/*
 * Choosing a different train on one leg, and what that does to the legs after
 * it. Pure and in a `.ts` so it is testable.
 *
 * The API anchors every leg's `upcomingDepartures` on the journey it timed, so
 * each list is "trains you can make if you caught the train before this one on
 * time". Picking a LATER train on one leg only pushes the legs after it later,
 * and the lists already contain everything they could move to. Nothing here
 * asks the server again.
 *
 * Whether a change can be made is the engine's call, not this file's: each
 * later ride carries `minChangeS`, the allowance the engine charged into it at
 * the rider's own pace, gates and in-station walking included. Copying that
 * rule here once let the client reject the engine's own connection for a brisk
 * rider and accept one it would refuse for a slow one.
 */

/*
 * A body from before `minChangeS` existed (KV, the app's own cache) still has
 * to resolve. A minute plus the walk at average pace is the engine's floor
 * for a change; it is only ever the stand-in, never the rule.
 */
const FALLBACK_MIN_CHANGE_S = 60
const FALLBACK_WALK_MS = 1.2

/** Spare time under this, beyond the change itself, makes a connection tight. */
const TIGHT_SLACK_S = 2 * 60

/** Past this many options a row of chips stops being scannable; use a ladder. */
export const CHIP_ROW_MAX = 4

/**
 * Why an option cannot be picked: the rider cannot reach it after the train
 * chosen before it, or nothing on a later leg connects from it.
 */
export type Blocked = 'MISSED' | 'NO_ONWARD'

export interface LegOption {
  departure: FareLegDeparture
  /** Null when the option can be picked. */
  blocked: Blocked | null
  selected: boolean
  /**
   * Seconds between getting off this train and boarding the next leg's earliest
   * train that still completes the journey. Null on the last timed leg, or when
   * nothing connects.
   */
  gapToNextS: number | null
  /** That change leaves less than TIGHT_SLACK_S beyond the engine's allowance. */
  tight: boolean
}

export interface TimedLeg {
  /** Index into the journey's `legs`. */
  index: number
  chosen: FareLegDeparture
  options: LegOption[]
}

const seconds = (iso: string) => Date.parse(iso) / 1000

const upcomingOf = (leg: FareResultLeg | undefined): readonly FareLegDeparture[] =>
  leg?.type === 'RIDE' ? (leg.upcomingDepartures ?? []) : []

/** The shortest change into leg `to` from the ride at `from`, by the engine's rule. */
function minChangeS(legs: readonly FareResultLeg[], from: number, to: number): number {
  const next = legs[to]
  if (next?.type === 'RIDE' && next.minChangeS !== undefined) return next.minChangeS
  let walkM = 0
  for (let i = from + 1; i < to; i++) {
    const leg = legs[i]
    if (leg?.type === 'TRANSFER') walkM += leg.distanceM
  }
  return Math.max(FALLBACK_MIN_CHANGE_S, Math.ceil(walkM / FALLBACK_WALK_MS))
}

const isTight = (gapS: number, minS: number) => gapS - minS < TIGHT_SLACK_S

/**
 * Every timed ride leg with its options, resolved against the rider's picks.
 *
 * `picks` maps a leg index to a `tripId`. A pick that can no longer be made, or
 * that no later train connects from, is ignored and the leg falls back to the
 * earliest train that works, so a stale pick never produces a connection that
 * runs backwards in time or a journey that stops halfway.
 */
export function resolveTimedLegs(legs: readonly FareResultLeg[], picks: Readonly<Record<number, string>>): TimedLeg[] {
  const timedIndexes = legs.flatMap((leg, index) => (upcomingOf(leg).length > 0 ? [index] : []))

  /*
   * Which trains on each leg can still finish the journey, worked back from the
   * last leg. Every train on the last leg can; a train on an earlier leg can if
   * some finishing train on the next leg leaves after it lands plus the change.
   * Without this, picking the last train on a leg whose next leg's list ends
   * sooner left no onward train, and the view fell apart into two journeys.
   */
  const finishing = new Map<number, ReadonlySet<string>>()
  for (let position = timedIndexes.length - 1; position >= 0; position--) {
    const index = timedIndexes[position]!
    const nextIndex = timedIndexes[position + 1]
    const upcoming = upcomingOf(legs[index])
    if (nextIndex === undefined) {
      finishing.set(index, new Set(upcoming.map(departure => departure.tripId)))
      continue
    }
    const change = minChangeS(legs, index, nextIndex)
    const nextFinishing = upcomingOf(legs[nextIndex]).filter(next => finishing.get(nextIndex)!.has(next.tripId))
    finishing.set(index, new Set(upcoming
      .filter(departure => nextFinishing.some(next => seconds(next.departureAt) >= seconds(departure.arrivalAt) + change))
      .map(departure => departure.tripId)))
  }

  const resolved: TimedLeg[] = []
  let previous: { index: number, arrivalS: number } | null = null

  for (const [position, index] of timedIndexes.entries()) {
    const upcoming = upcomingOf(legs[index])
    const earliest: number = previous
      ? previous.arrivalS + minChangeS(legs, previous.index, index)
      : Number.NEGATIVE_INFINITY
    const blockedOf = (departure: FareLegDeparture): Blocked | null => {
      if (seconds(departure.departureAt) < earliest) return 'MISSED'
      return finishing.get(index)!.has(departure.tripId) ? null : 'NO_ONWARD'
    }

    const picked = upcoming.find(departure => departure.tripId === picks[index] && blockedOf(departure) === null)
    const chosen = picked ?? upcoming.find(departure => blockedOf(departure) === null)
    // Nothing usable: only possible on a body without `minChangeS` whose
    // fallback disagrees with the engine. Stop rather than emit a connection
    // that runs backwards; the caller keeps the legs it already had.
    if (!chosen) break

    const nextIndex = timedIndexes[position + 1]
    const change = nextIndex === undefined ? 0 : minChangeS(legs, index, nextIndex)
    const nextUpcoming = nextIndex === undefined
      ? []
      : upcomingOf(legs[nextIndex]).filter(next => finishing.get(nextIndex)!.has(next.tripId))
    const options = upcoming.map((departure): LegOption => {
      const nextTrain = nextUpcoming.find(next => seconds(next.departureAt) >= seconds(departure.arrivalAt) + change)
      const gapToNextS = nextTrain ? seconds(nextTrain.departureAt) - seconds(departure.arrivalAt) : null
      return {
        departure,
        blocked: blockedOf(departure),
        selected: departure.tripId === chosen.tripId,
        gapToNextS,
        tight: gapToNextS !== null && isTight(gapToNextS, change)
      }
    })

    resolved.push({ index, chosen, options })
    previous = { index, arrivalS: seconds(chosen.arrivalAt) }
  }
  return resolved
}

/**
 * The change at a point in the timeline: from the last timed ride before
 * `index` to the first one at or after it, with whether it is tight. Null when
 * either side is untimed, because a gap with one end unknown is not a number.
 */
export function changeAt(
  legs: readonly FareResultLeg[],
  timed: readonly TimedLeg[],
  index: number
): { gapS: number, tight: boolean } | null {
  const before = timed.filter(leg => leg.index < index).at(-1)
  const after = timed.find(leg => leg.index >= index)
  if (!before || !after) return null
  const gapS = seconds(after.chosen.departureAt) - seconds(before.chosen.arrivalAt)
  return { gapS, tight: isTight(gapS, minChangeS(legs, before.index, after.index)) }
}

/**
 * The journey's own clock after the picks: when it leaves and when it lands.
 * Null when no ride leg is timed.
 */
export function journeyClockOf(timed: readonly TimedLeg[]): { departureAt: string, arrivalAt: string } | null {
  const first = timed[0]
  const last = timed.at(-1)
  return first && last ? { departureAt: first.chosen.departureAt, arrivalAt: last.chosen.arrivalAt } : null
}

/*
 * The journey as the rider's picks have re-timed it, so every surface that
 * reads a journey (the plate, the timeline, the clock line) agrees with the
 * train they chose rather than the one the API caught.
 *
 * A leg whose train changed loses `stopTimes` and `lastService`: both describe
 * the boarded trip, and the upcoming list carries neither for the others. Absent
 * means "unknown" and the UI omits it, which is the schema's own rule.
 *
 * Unchanged, as the same object, when nothing was picked or the picks could not
 * be resolved for every timed leg — a half re-timed journey would print an
 * arrival that skipped a leg.
 */
export function retimeJourney(journey: FareJourney, timed: readonly TimedLeg[]): FareJourney {
  const timedCount = journey.legs.filter(leg => upcomingOf(leg).length > 0).length
  const changed = timed.some(({ index, chosen }) => {
    const leg = journey.legs[index]
    return leg?.type === 'RIDE' && leg.tripId !== chosen.tripId
  })
  if (!changed || timed.length !== timedCount) return journey

  const byIndex = new Map(timed.map(leg => [leg.index, leg.chosen]))
  const legs = journey.legs.map((leg, index): FareResultLeg => {
    const chosen = byIndex.get(index)
    if (leg.type !== 'RIDE' || !chosen || chosen.tripId === leg.tripId) return leg
    const next = {
      ...leg,
      line: chosen.line,
      headsign: chosen.headsign ?? leg.headsign,
      departureAt: chosen.departureAt,
      arrivalAt: chosen.arrivalAt,
      tripId: chosen.tripId
    }
    delete next.stopTimes
    delete next.lastService
    return next
  })
  const clock = journeyClockOf(timed)
  /*
   * `moreDepartures` is dropped: it lists the route's other boardings relative
   * to the train the API caught, so after a pick it would name the train the
   * rider just chose as a "later" one. The chips on each leg are the
   * authority on alternatives once the rider is choosing among them.
   */
  const view: FareJourney = { ...journey, legs, ...(journey.arrivalAt && clock ? { arrivalAt: clock.arrivalAt } : {}) }
  delete view.moreDepartures
  return view
}

/**
 * "Berangkat 4 mnt lagi", or null when the departure is more than an hour away
 * and the clock alone says it better.
 */
export function leaveInLabel(departureAt: string, nowMs: number): string | null {
  const minutes = Math.floor((Date.parse(departureAt) - nowMs) / 60000)
  if (minutes < -1) return 'Sudah berangkat'
  if (minutes <= 0) return 'Berangkat sekarang'
  return minutes < 60 ? `Berangkat ${minutes} mnt lagi` : null
}
