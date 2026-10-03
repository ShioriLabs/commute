package id.shiorilabs.commute.feature.journey.domain

import java.time.Instant
import java.time.format.DateTimeFormatter

/*
 * A shareable name for one ROUTE, so a link reopens the journey the sender was looking at rather
 * than just the pair: a port of the web's `utils/journey-key.ts`, and it has to stay one, since the
 * key travels in links between the two.
 *
 * It names the route's shape (which line, boarded where, left where, in order), never an index:
 * the API retimes and re-sorts the list per request, so "option 3" is a different journey a minute
 * later. The recipient's own request supplies the departures.
 *
 * `~` between legs, `.` after the line code, `-` between stops, `_` for a transfer: unreserved in a
 * URL, and none of them can appear inside a line code or a station id.
 */

/** `KCI-CUK` to `CUK`: the operator is implied by the line beside it. */
private fun bare(stationId: String): String = stationId.substring(stationId.indexOf('-') + 1)

fun journeyKey(journey: Journey): String = journey.legs.joinToString("~") { leg ->
    when (leg) {
        is JourneyLeg.Ride -> leg.line.substring(leg.line.indexOf(':') + 1) + "." + bare(leg.from.id) + "-" + bare(leg.to.id)
        is JourneyLeg.Transfer -> "_" + bare(leg.to.id)
    }
}

/** When a journey boards: its first timed ride's departure, or `null` when it is untimed. */
fun boardsAtOf(journey: Journey): Instant? =
    journey.legs.firstNotNullOfOrNull { leg -> (leg as? JourneyLeg.Ride)?.departureAt }

/**
 * A boarding as `HHmm` wall-clock WIB, for a link's `?jt=`.
 *
 * The key above names no time, which is right for a shared link but wrong for home's saved pairs:
 * their rows of one route share a key, so every one of them would open on the earliest. `jt` is the
 * extra fact those links carry, as clock digits that only have to tell boardings of one route apart
 * within one answer.
 */
fun boardingClock(instant: Instant): String = BOARDING_CLOCK.format(instant)

private val BOARDING_CLOCK = DateTimeFormatter.ofPattern("HHmm").withZone(JAKARTA)

/**
 * Which journey [key] names, or `null`: a route can stop running between sender and recipient.
 *
 * With [boardsAt] (a `?jt=` clock), the boarding of that route at that time wins; when that train
 * is no longer in the answer, the route's first boarding still beats an unrelated row.
 */
fun findJourneyByKey(journeys: List<Journey>, key: String?, boardsAt: String? = null): Int? {
    if (key.isNullOrEmpty()) {
        return null
    }
    if (!boardsAt.isNullOrEmpty()) {
        val exact = journeys.indexOfFirst { journey ->
            journeyKey(journey) == key && boardsAtOf(journey)?.let(::boardingClock) == boardsAt
        }
        if (exact >= 0) {
            return exact
        }
    }
    return journeys.indexOfFirst { journeyKey(it) == key }.takeIf { it >= 0 }
}
