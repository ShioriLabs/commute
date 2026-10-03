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
fun upcomingJourneys(journeys: List<Journey>, now: Instant, limit: Int = SAVED_ROUTE_ROWS): List<Journey> {
    val timed = mutableListOf<Pair<Journey, Instant>>()
    val untimed = mutableListOf<Journey>()
    for (journey in journeys) {
        if (journey.resumesAt != null) {
            continue
        }
        val boardsAt = boardsAtOf(journey)
        when {
            boardsAt == null -> untimed += journey
            !boardsAt.isBefore(now) -> timed += journey to boardsAt
        }
    }
    return (timed.sortedBy { it.second }.map { it.first } + untimed).take(limit)
}

/**
 * When the pair can be ridden again, for "Udahan · mulai lagi 04.05": the earliest restart among
 * the routes that have ended. `null` when none says, and the card says "Udahan" alone.
 */
fun resumeTimeOf(journeys: List<Journey>): Instant? = journeys.mapNotNull { it.resumesAt }.minOrNull()
