import type { FareJourney, FareJourneyDeparture } from '@commute/schemas'
import { boardsAtOf } from 'utils/journey-key'
import { liveDeparturesOf } from '~/components/fare-sheet/journeys'

/*
 * The rows a saved pair shows on home: one per route, soonest first, each with
 * the trains on it that have not left yet.
 *
 * The planner orders journeys by how sensible the ROUTE is, and its answer is
 * cached per 20-minute slot, so the body can still hold boardings that left a
 * few minutes ago. Home is a "when is my train" surface rather than a "which
 * way" one, so it re-sorts by the next live boarding and drops a route only
 * once every train it carries has gone.
 *
 * Untimed journeys (any TransJakarta first leg) have no clock to sort on and
 * cannot go stale, so they follow the timed rows in the planner's own order,
 * with no departures. A route whose service has ended for the night is not a
 * row at all: the API marks it with `resumesAt`, and offering it untimed would
 * read as rideable.
 */
export interface UpcomingRow {
  journey: FareJourney
  /** Live boardings, soonest first; `[0]` is the one the row leads with. Empty when untimed. */
  departures: FareJourneyDeparture[]
}

export function upcomingJourneys(journeys: readonly FareJourney[], now: number, limit: number): UpcomingRow[] {
  const timed: UpcomingRow[] = []
  const untimed: UpcomingRow[] = []
  for (const journey of journeys) {
    // Done for the night: not a row, see resumeTimeOf.
    if (journey.resumesAt) continue
    if (boardsAtOf(journey) === null) {
      untimed.push({ journey, departures: [] })
      continue
    }
    const departures = liveDeparturesOf(journey, now)
    if (departures.length > 0) timed.push({ journey, departures })
  }
  timed.sort((a, b) => Date.parse(a.departures[0]!.departureAt) - Date.parse(b.departures[0]!.departureAt))
  return [...timed, ...untimed].slice(0, limit)
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
