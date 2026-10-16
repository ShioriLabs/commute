package id.shiorilabs.commute.feature.journey.domain

import java.time.Instant

/*
 * The rows a saved pair shows on home: what leaves next, soonest first. The web's
 * `saved-route-card/upcoming.ts`.
 */

/** How many boardings a saved pair's card shows. */
const val SAVED_ROUTE_ROWS = 3

/**
 * The next boardings of [journeys] at [now], at most [limit].
 *
 * The planner orders journeys by how sensible the ROUTE is, and its answer is cached per departure
 * slot, so it can still hold boardings that left a few minutes ago. Home is a "when is my train"
 * surface rather than a "which way" one, so this re-sorts by boarding time and drops anything gone.
 *
 * An untimed journey (any TransJakarta first leg) has no clock to sort on and can't go stale, so it
 * follows the timed ones in the planner's own order. A route whose service has ended for the night
 * is not a row at all: the API marks it with [Journey.resumesAt], and offered untimed it would read
 * as rideable.
 */
fun upcomingJourneys(journeys: List<Journey>, now: Instant, limit: Int = SAVED_ROUTE_ROWS): List<UpcomingRow> {
    val timed = mutableListOf<UpcomingRow>()
    val untimed = mutableListOf<UpcomingRow>()
    for (journey in journeys) {
        if (journey.resumesAt != null) {
            continue
        }
        if (boardsAtOf(journey) == null) {
            untimed += UpcomingRow(journey, emptyList())
            continue
        }
        val departures = liveDeparturesOf(journey, now)
        if (departures.isNotEmpty()) {
            timed += UpcomingRow(journey, departures)
        }
    }
    return (timed.sortedBy { it.departures.first().departureAt } + untimed).take(limit)
}

/** One route on a saved pair's card, with the trains on it that have not left yet. */
data class UpcomingRow(
    val journey: Journey,
    /** Soonest first; the first leads the row. Empty when the route is untimed. */
    val departures: List<JourneyDeparture>,
)

/**
 * A route's boardings that have not left yet: the journey's own train, then the later ones riding
 * along in [Journey.moreDepartures]. Filtered against the clock because home holds an answer for a
 * whole departure slot, so the own train can be gone while the next ones are still catchable.
 */
fun liveDeparturesOf(journey: Journey, now: Instant): List<JourneyDeparture> {
    val boardsAt = boardsAtOf(journey) ?: return emptyList()
    return (listOf(JourneyDeparture(boardsAt, journey.arrivalAt)) + journey.moreDepartures)
        .filter { !it.departureAt.isBefore(now) }
}

/**
 * When the pair can be ridden again, for "Udahan · mulai lagi 04.05": the earliest restart among
 * the routes that have ended. `null` when none says, and the card says "Udahan" alone.
 */
fun resumeTimeOf(journeys: List<Journey>): Instant? = journeys.mapNotNull { it.resumesAt }.minOrNull()
