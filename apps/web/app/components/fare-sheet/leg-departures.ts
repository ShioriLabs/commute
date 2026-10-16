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
 * What the client cannot know is the engine's exact change allowance (it
 * depends on the rider's walking pace and which gates are crossed), so it does
 * not promise one. It enforces the one part that is a hard floor in the engine —
 * no change under a minute, and no faster than a walk at average pace over the
 * transfer legs between — and leaves the rest to `connectionOf`, which names a
 * thin connection as thin instead of pretending it is safe.
 */

/** Same floor and pace as the engine's departures.ts: MIN_CHANGE_S, AVERAGE. */
const MIN_CHANGE_S = 60
const AVERAGE_WALK_MS = 1.2

/** Under this a change is tight; at or over `COMFORTABLE_GAP_S` it is easy. */
const TIGHT_GAP_S = 4 * 60
const COMFORTABLE_GAP_S = 8 * 60

/** Past this many options a row of chips stops being scannable; use a ladder. */
export const CHIP_ROW_MAX = 4

export type Connection = 'LONGGAR' | 'PAS' | 'MEPET'

export interface LegOption {
  departure: FareLegDeparture
  /** Reachable from the train chosen on the leg before. */
  reachable: boolean
  selected: boolean
  /**
   * Seconds between getting off this train and boarding the next leg's earliest
   * reachable one. Null on the last timed leg, or when nothing connects.
   */
  gapToNextS: number | null
}

export interface TimedLeg {
  /** Index into the journey's `legs`. */
  index: number
  chosen: FareLegDeparture
  options: LegOption[]
}

const seconds = (iso: string) => Date.parse(iso) / 1000

/** The shortest change the engine could have allowed across these legs. */
function changeFloorS(legs: readonly FareResultLeg[], from: number, to: number): number {
  let walkM = 0
  for (let i = from + 1; i < to; i++) {
    const leg = legs[i]
    if (leg?.type === 'TRANSFER') walkM += leg.distanceM
  }
  return Math.max(MIN_CHANGE_S, Math.ceil(walkM / AVERAGE_WALK_MS))
}

const upcomingOf = (leg: FareResultLeg | undefined): readonly FareLegDeparture[] =>
  leg?.type === 'RIDE' ? (leg.upcomingDepartures ?? []) : []

/**
 * Every timed ride leg with its options, resolved against the rider's picks.
 *
 * `picks` maps a leg index to a `tripId`. A pick that no longer connects after
 * an earlier leg moved later is ignored and the leg falls back to the earliest
 * train that does, so a stale pick can never produce a connection that runs
 * backwards in time.
 */
export function resolveTimedLegs(legs: readonly FareResultLeg[], picks: Readonly<Record<number, string>>): TimedLeg[] {
  const timedIndexes = legs.flatMap((leg, index) => (upcomingOf(leg).length > 0 ? [index] : []))
  const resolved: TimedLeg[] = []
  let previous: { index: number, arrivalS: number } | null = null

  for (const [position, index] of timedIndexes.entries()) {
    const upcoming = upcomingOf(legs[index])
    const earliest: number = previous
      ? previous.arrivalS + changeFloorS(legs, previous.index, index)
      : Number.NEGATIVE_INFINITY
    const reachableOf = (departure: FareLegDeparture) => seconds(departure.departureAt) >= earliest

    const picked = upcoming.find(departure => departure.tripId === picks[index] && reachableOf(departure))
    const chosen = picked ?? upcoming.find(reachableOf)
    // Nothing reachable: the journey cannot be re-timed past this leg, so stop
    // rather than emit a connection that runs backwards. The caller keeps the
    // legs it already had.
    if (!chosen) break

    const nextIndex = timedIndexes[position + 1]
    const nextUpcoming = nextIndex === undefined ? [] : upcomingOf(legs[nextIndex])
    const options = upcoming.map((departure): LegOption => {
      const nextFloor = nextIndex === undefined ? 0 : changeFloorS(legs, index, nextIndex)
      const nextTrain = nextUpcoming.find(next => seconds(next.departureAt) >= seconds(departure.arrivalAt) + nextFloor)
      return {
        departure,
        reachable: reachableOf(departure),
        selected: departure.tripId === chosen.tripId,
        gapToNextS: nextTrain ? seconds(nextTrain.departureAt) - seconds(departure.arrivalAt) : null
      }
    })

    resolved.push({ index, chosen, options })
    previous = { index, arrivalS: seconds(chosen.arrivalAt) }
  }
  return resolved
}

/** How easy a change is, from the gap between arriving and the next boarding. */
export function connectionOf(gapS: number): Connection {
  if (gapS < TIGHT_GAP_S) return 'MEPET'
  return gapS >= COMFORTABLE_GAP_S ? 'LONGGAR' : 'PAS'
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
