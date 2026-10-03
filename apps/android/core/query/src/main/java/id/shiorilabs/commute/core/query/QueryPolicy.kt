package id.shiorilabs.commute.core.query

import java.time.Duration
import java.time.Instant

/**
 * When a cached answer stops being fresh. A fresh answer is served without asking; a stale one is
 * still served, but revalidated (with its ETag, so usually for a 304) whenever someone observes it.
 *
 * Nothing ever expires outright: offline, an answer of any age is better than none, and the screen
 * says how old it is.
 *
 * @property staleAt When an answer confirmed at the given instant goes stale.
 */
class QueryPolicy(val staleAt: (fetchedAt: Instant) -> Instant) {

    companion object {

        /** Fresh for [duration] after it was confirmed. */
        fun freshFor(duration: Duration): QueryPolicy = QueryPolicy { it + duration }

        // The presets follow the API's own `Cache-Control` max-ages
        // (apps/api/src/middleware/cache-control.ts), so the app asks no more often than a shared
        // cache in front of the API would.

        /** Operators and lines: compiled into the API, changed only by a deploy. */
        val Static: QueryPolicy = freshFor(Duration.ofHours(24))

        /** Stations, transfers, headways and the search index: changed when an importer runs. */
        val Topology: QueryPolicy = freshFor(Duration.ofHours(1))

        /** Timetables: changed with a schedule, and kept tighter than topology on purpose. */
        val Timetable: QueryPolicy = freshFor(Duration.ofMinutes(30))

        /** Fares and trips at a picked time: priced by peak bucket, so short-lived. */
        val Fare: QueryPolicy = freshFor(Duration.ofMinutes(10))
    }
}
