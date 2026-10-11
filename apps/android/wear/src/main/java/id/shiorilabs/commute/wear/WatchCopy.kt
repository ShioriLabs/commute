package id.shiorilabs.commute.wear

import android.content.res.Resources
import id.shiorilabs.commute.core.time.formatClock
import id.shiorilabs.commute.core.trip.Headline
import id.shiorilabs.commute.core.trip.PositionSource
import id.shiorilabs.commute.core.trip.TripLeg
import id.shiorilabs.commute.core.trip.TripPhase
import id.shiorilabs.commute.core.trip.TripState
import id.shiorilabs.commute.core.trip.minutesUntil
import id.shiorilabs.commute.core.tripcopy.R as CopyR
import id.shiorilabs.commute.core.tripcopy.TripWording
import id.shiorilabs.commute.core.wearable.WearLine
import java.time.Instant

/**
 * The trip in words on the watch: the phone's Live Update wording, shortened for a round screen,
 * with times as minutes from now where they're near. [lines] names the rides; a line it lacks shows
 * its bare code.
 */
class WatchCopy(private val resources: Resources, private val lines: Map<String, WearLine>) {

    private val wording = TripWording(resources) { lines[it]?.name }

    fun rideName(ride: TripLeg.Ride): String = wording.rideName(ride)

    fun direction(ride: TripLeg.Ride): String? = wording.direction(ride)

    fun title(headline: Headline): String = wording.title(headline)

    /** The small line over [place]: what to do there. */
    fun lead(headline: Headline): String = resources.getString(
        when (headline) {
            is Headline.Board -> R.string.trip_lead_board
            is Headline.Change -> R.string.trip_lead_change
            is Headline.RideTo, is Headline.AlightNow -> R.string.trip_lead_alight
            is Headline.Arrived -> R.string.trip_lead_arrived
        },
    )

    /** What the screen leads with, big: the ride to take, or the stop to get off at. */
    fun place(headline: Headline): String = when (headline) {
        is Headline.Board -> rideName(headline.ride)
        is Headline.Change -> rideName(headline.ride)
        is Headline.RideTo -> headline.ride.stops.last().name
        is Headline.AlightNow -> headline.ride.stops.last().name
        is Headline.Arrived -> headline.destination
    }

    /**
     * The ride's own line over the headline: its direction while it's still to be caught, so the
     * line's name isn't said twice, and its name once aboard. One bus route is "Kor L13E" there
     * throughout, beside its roundel.
     */
    fun rideLabel(headline: Headline, ride: TripLeg.Ride): String = when {
        ride.isBus && ride.otherLines == 0 -> resources.getString(R.string.trip_corridor_short, ride.line.substringAfter(':'))
        else -> rideLabelOf(headline, ride)
    }

    private fun rideLabelOf(headline: Headline, ride: TripLeg.Ride): String = when (headline) {
        is Headline.Board, is Headline.Change ->
            direction(ride) ?: rideName(ride)
        else -> rideName(ride)
    }

    /**
     * Minutes to the moment that matters, when it's within the hour: the train leaving while it's
     * waited for, getting off once aboard. `null` when there is no time to count to.
     */
    fun minutes(state: TripState, headline: Headline, now: Instant): String? {
        val at = when (headline) {
            is Headline.Board -> headline.departsAt
            is Headline.Change -> headline.departsAt
            is Headline.RideTo -> headline.alightsAt?.takeIf { state.source != PositionSource.UNKNOWN }
            else -> null
        } ?: return null
        val minutes = minutesUntil(now, at)
        if (!at.isAfter(now) || minutes >= NEAR_MINUTES) return null
        return resources.getString(R.string.trip_minutes, minutes)
    }

    /** What else there is to know, after [minutes]. */
    fun detail(state: TripState, headline: Headline, now: Instant): String = when (headline) {
        is Headline.Board -> listOfNotNull(
            platform(headline.ride),
            headline.departsAt?.takeIf { minutes(state, headline, now) == null }
                ?.let { resources.getString(CopyR.string.trip_departs_at, formatClock(it)) },
        )
        is Headline.Change -> listOfNotNull(
            headline.walk?.let { resources.getString(CopyR.string.trip_walk_to, it.to.name, it.distanceM) },
            platform(headline.ride),
            headline.departsAt?.takeIf { minutes(state, headline, now) == null }
                ?.let { resources.getString(CopyR.string.trip_departs_at, formatClock(it)) },
        )
        is Headline.RideTo -> listOf(
            resources.getString(
                if (headline.ride.isBus) CopyR.string.trip_haltes_left else CopyR.string.trip_stations_left,
                headline.stopsLeft,
            ),
        )
        is Headline.AlightNow -> listOf(
            headline.then?.let { resources.getString(CopyR.string.trip_then_change, rideName(it)) }
                ?: resources.getString(CopyR.string.trip_then_done),
        )
        is Headline.Arrived -> emptyList()
    }.joinToString(SEPARATOR)

    /** [minutes] and [detail] on one line, for the notification. */
    fun summary(state: TripState, headline: Headline, now: Instant): String =
        listOfNotNull(minutes(state, headline, now), detail(state, headline, now).ifEmpty { null })
            .joinToString(SEPARATOR)

    /** How the position is known, when it isn't from GPS; `null` once arrived. */
    fun source(state: TripState): String? = when {
        state.phase == TripPhase.ARRIVED -> null
        state.source == PositionSource.ESTIMATED -> resources.getString(CopyR.string.trip_source_estimated)
        state.source == PositionSource.UNKNOWN -> resources.getString(CopyR.string.trip_source_unknown)
        else -> null
    }

    private fun platform(ride: TripLeg.Ride): String? =
        ride.platformCode?.let { resources.getString(CopyR.string.trip_platform, it.replace(PLATFORM_SLASH, "·")) }

    companion object {

        const val SEPARATOR = " · "
        private const val NEAR_MINUTES = 60
        private val PLATFORM_SLASH = Regex("\\s*/\\s*")
    }
}
