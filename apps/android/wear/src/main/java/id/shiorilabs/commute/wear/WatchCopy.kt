package id.shiorilabs.commute.wear

import android.content.res.Resources
import id.shiorilabs.commute.core.trip.Headline
import id.shiorilabs.commute.core.trip.PositionSource
import id.shiorilabs.commute.core.trip.TripLeg
import id.shiorilabs.commute.core.trip.TripPhase
import id.shiorilabs.commute.core.trip.TripState
import id.shiorilabs.commute.core.trip.minutesUntil
import id.shiorilabs.commute.core.wearable.WearLine
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

/**
 * The trip in words on the watch: the phone's Live Update wording, shortened for a round screen,
 * with times as minutes from now where they're near. [lines] names the rides; a line it lacks shows
 * its bare code.
 */
class WatchCopy(private val resources: Resources, private val lines: Map<String, WearLine>) {

    fun rideName(ride: TripLeg.Ride): String = lines[ride.line]?.name ?: ride.line.substringAfter(':')

    fun title(headline: Headline): String = when (headline) {
        is Headline.Board -> resources.getString(R.string.trip_board, rideName(headline.ride))
        is Headline.Change -> resources.getString(R.string.trip_change, rideName(headline.ride))
        is Headline.RideTo -> resources.getString(R.string.trip_ride_to, headline.ride.stops.last().name)
        is Headline.AlightNow -> resources.getString(R.string.trip_alight_now, headline.ride.stops.last().name)
        is Headline.Arrived -> resources.getString(R.string.trip_arrived, headline.destination)
    }

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
     * line's name isn't said twice, and its name once aboard.
     */
    fun rideLabel(headline: Headline, ride: TripLeg.Ride): String = when (headline) {
        is Headline.Board, is Headline.Change ->
            ride.headsign?.let { resources.getString(R.string.trip_headsign, it) } ?: rideName(ride)
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
                ?.let { resources.getString(R.string.trip_departs_at, formatClock(it)) },
        )
        is Headline.Change -> listOfNotNull(
            headline.walk?.let { resources.getString(R.string.trip_walk_to, it.to.name, it.distanceM) },
            platform(headline.ride),
            headline.departsAt?.takeIf { minutes(state, headline, now) == null }
                ?.let { resources.getString(R.string.trip_departs_at, formatClock(it)) },
        )
        is Headline.RideTo -> listOf(
            resources.getString(
                if (headline.ride.isBus) R.string.trip_haltes_left else R.string.trip_stations_left,
                headline.stopsLeft,
            ),
        )
        is Headline.AlightNow -> listOf(
            headline.then?.let { resources.getString(R.string.trip_then_change, rideName(it)) }
                ?: resources.getString(R.string.trip_then_done),
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
        state.source == PositionSource.ESTIMATED -> resources.getString(R.string.trip_source_estimated)
        state.source == PositionSource.UNKNOWN -> resources.getString(R.string.trip_source_unknown)
        else -> null
    }

    private fun platform(ride: TripLeg.Ride): String? =
        ride.platformCode?.let { resources.getString(R.string.trip_platform, it.replace(PLATFORM_SLASH, "·")) }

    companion object {

        const val SEPARATOR = " · "
        private const val NEAR_MINUTES = 60
        private val PLATFORM_SLASH = Regex("\\s*/\\s*")
    }
}

private val CLOCK: DateTimeFormatter = DateTimeFormatter.ofPattern("HH.mm").withZone(ZoneId.of("Asia/Jakarta"))

/** `08.11`, the way the phone writes a time, in WIB wherever the watch is. */
fun formatClock(at: Instant): String = CLOCK.format(at)
