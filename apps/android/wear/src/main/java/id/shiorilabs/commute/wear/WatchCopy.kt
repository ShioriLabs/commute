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

    fun detail(state: TripState, headline: Headline, now: Instant): String = when (headline) {
        is Headline.Board -> listOfNotNull(
            headline.ride.headsign?.let { resources.getString(R.string.trip_headsign, it) },
            platform(headline.ride),
            headline.departsAt?.let { departs(it, now) },
        )
        is Headline.Change -> listOfNotNull(
            headline.walk?.let { resources.getString(R.string.trip_walk_to, it.to.name, it.distanceM) },
            headline.ride.headsign?.let { resources.getString(R.string.trip_headsign, it) },
            platform(headline.ride),
            headline.departsAt?.let { departs(it, now) },
        )
        is Headline.RideTo -> listOfNotNull(
            resources.getString(
                if (headline.ride.isBus) R.string.trip_haltes_left else R.string.trip_stations_left,
                headline.stopsLeft,
            ),
            headline.alightsAt?.takeIf { state.source != PositionSource.UNKNOWN && it.isAfter(now) }
                ?.let { resources.getString(R.string.trip_alights_in, minutesUntil(now, it)) },
        )
        is Headline.AlightNow -> listOf(
            headline.then?.let { resources.getString(R.string.trip_then_change, rideName(it)) }
                ?: resources.getString(R.string.trip_then_done),
        )
        is Headline.Arrived -> emptyList()
    }.joinToString(SEPARATOR)

    /** How the position is known, when it isn't from GPS; `null` once arrived. */
    fun source(state: TripState): String? = when {
        state.phase == TripPhase.ARRIVED -> null
        state.source == PositionSource.ESTIMATED -> resources.getString(R.string.trip_source_estimated)
        state.source == PositionSource.UNKNOWN -> resources.getString(R.string.trip_source_unknown)
        else -> null
    }

    /** "berangkat 3 mnt lagi" within the hour, "berangkat 08.11" beyond it. */
    private fun departs(at: Instant, now: Instant): String {
        val minutes = minutesUntil(now, at)
        return if (at.isAfter(now) && minutes < NEAR_MINUTES) {
            resources.getString(R.string.trip_departs_in, minutes)
        } else {
            resources.getString(R.string.trip_departs_at, formatClock(at))
        }
    }

    private fun platform(ride: TripLeg.Ride): String? =
        ride.platformCode?.let { resources.getString(R.string.trip_platform, it.replace(PLATFORM_SLASH, "·")) }

    private companion object {

        const val SEPARATOR = " · "
        const val NEAR_MINUTES = 60
        val PLATFORM_SLASH = Regex("\\s*/\\s*")
    }
}

private val CLOCK: DateTimeFormatter = DateTimeFormatter.ofPattern("HH.mm").withZone(ZoneId.of("Asia/Jakarta"))

/** `08.11`, the way the phone writes a time, in WIB wherever the watch is. */
fun formatClock(at: Instant): String = CLOCK.format(at)
