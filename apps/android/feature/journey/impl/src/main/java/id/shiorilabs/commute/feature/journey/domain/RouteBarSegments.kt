package id.shiorilabs.commute.feature.journey.domain

/*
 * The route bar's geometry, worked out as data so it can be tested: the web's
 * `fare-sheet/route-bar-segments.ts`.
 */

/** Stand-in for a line key the dictionary does not know yet: grey reads as "unknown line". */
const val LINE_COLOR_FALLBACK = "#888888"

/** One line as the bar and the timeline draw it. */
data class LegLine(
    /** `OPERATOR:CODE`. */
    val key: String,
    /** The bare code a roundel shows. */
    val code: String,
    val name: String,
    /** `#RRGGBB`. */
    val color: String,
    val headsign: String?,
)

sealed interface RouteBarSegment {

    data class Ride(
        /** Drives the segment's weight, so rides stay proportional to the ground they cover. */
        val distanceM: Int,
        /** Share of the bar's ride width, 0 to 1. */
        val share: Double,
        /** One per service line; more than one means interlined track. */
        val colors: List<String>,
        val code: String,
        val name: String,
        /** TransJakarta corridors are filled roundels, rail ringed. */
        val operator: String,
    ) : RouteBarSegment

    /**
     * A transfer, drawn as a leg of its own rather than a gap. [distanceM] is `null` when the walk
     * is unmeasured or the change happens where the rider already stands.
     */
    data class Walk(val distanceM: Int?) : RouteBarSegment
}

/**
 * The bar's segments. Rides are sized against each other by distance; walks are not, since 400 m
 * beside a 14 km ride could never hold its own figure, so they take the room their label needs.
 *
 * Only the legs from the first ride to the last: a walk before boarding dangles off the end with no
 * ride to connect to. The timeline still draws it.
 */
fun routeBarSegments(legs: List<JourneyLeg>, resolve: (JourneyLeg.Ride) -> List<LegLine>): List<RouteBarSegment> {
    val first = legs.indexOfFirst { it is JourneyLeg.Ride }
    if (first < 0) {
        return emptyList()
    }
    val last = legs.indexOfLast { it is JourneyLeg.Ride }
    val total = legs.filterIsInstance<JourneyLeg.Ride>().sumOf { it.distanceM.coerceAtLeast(0) }

    return legs.subList(first, last + 1).map { leg ->
        when (leg) {
            // Zero means the walk was not measured, not that there is none.
            is JourneyLeg.Transfer -> RouteBarSegment.Walk(leg.distanceM.takeIf { it > 0 })
            is JourneyLeg.Ride -> {
                val lines = resolve(leg)
                val distanceM = leg.distanceM.coerceAtLeast(0)
                RouteBarSegment.Ride(
                    distanceM = distanceM,
                    // Guarded: a NaN share would quietly flatten every segment.
                    share = if (total > 0) distanceM.toDouble() / total else 0.0,
                    colors = lines.map { it.color }.ifEmpty { listOf(LINE_COLOR_FALLBACK) },
                    code = lines.firstOrNull()?.code.orEmpty(),
                    name = lines.firstOrNull()?.name.orEmpty(),
                    operator = leg.operator,
                )
            }
        }
    }
}
