package id.shiorilabs.commute.feature.journey.domain

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

/** Which journey [key] names, or `null`: a route can stop running between sender and recipient. */
fun findJourneyByKey(journeys: List<Journey>, key: String?): Int? {
    if (key.isNullOrEmpty()) {
        return null
    }
    return journeys.indexOfFirst { journeyKey(it) == key }.takeIf { it >= 0 }
}
