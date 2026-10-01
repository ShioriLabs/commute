import type { FareJourney } from '@commute/schemas'
import { boardsAtOf } from 'utils/journey-key'

/*
 * The rows a saved pair shows on home: what leaves next, soonest first.
 *
 * The planner orders journeys by how sensible the ROUTE is, and its answer is
 * cached per 20-minute slot, so the body can still hold boardings that left a
 * few minutes ago. Home is a "when is my train" surface rather than a "which
 * way" one, so it re-sorts by boarding time and drops anything already gone.
 *
 * Untimed journeys (any TransJakarta first leg) have no clock to sort on and
 * cannot go stale, so they follow the timed rows in the planner's own order.
 * A route whose service has ended for the night is not a row at all: the API
 * marks it with `resumesAt`, and offering it untimed would read as rideable.
 */
export function upcomingJourneys(journeys: readonly FareJourney[], now: number, limit: number): FareJourney[] {
  const timed: Array<{ journey: FareJourney, at: number }> = []
  const untimed: FareJourney[] = []
  for (const journey of journeys) {
    // Done for the night: not a row, see resumeTimeOf.
    if (journey.resumesAt) continue
    const boardsAt = boardsAtOf(journey)
    if (boardsAt === null) {
      untimed.push(journey)
      continue
    }
    const at = Date.parse(boardsAt)
    if (at >= now) timed.push({ journey, at })
  }
  timed.sort((a, b) => a.at - b.at)
  return [...timed.map(entry => entry.journey), ...untimed].slice(0, limit)
}

/*
 * When the pair can be ridden again, for "Udahan · mulai lagi HH.MM": the
 * earliest restart among the routes that have ended. Null when none says, in
 * which case the card shows "Udahan" alone.
 */
export function resumeTimeOf(journeys: readonly FareJourney[]): string | null {
  let earliest: string | null = null
  for (const journey of journeys) {
    if (journey.resumesAt && (earliest === null || Date.parse(journey.resumesAt) < Date.parse(earliest))) {
      earliest = journey.resumesAt
    }
  }
  return earliest
}
