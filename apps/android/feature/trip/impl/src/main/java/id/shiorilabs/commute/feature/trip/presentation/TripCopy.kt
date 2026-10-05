package id.shiorilabs.commute.feature.trip.presentation

import android.content.res.Resources
import id.shiorilabs.commute.core.trip.Headline
import id.shiorilabs.commute.core.trip.PositionSource
import id.shiorilabs.commute.core.trip.TripLeg
import id.shiorilabs.commute.core.trip.TripPhase
import id.shiorilabs.commute.feature.station.domain.LineInfo
import id.shiorilabs.commute.feature.trip.ActiveTrip
import id.shiorilabs.commute.feature.station.domain.formatPlatformCode
import id.shiorilabs.commute.feature.trip.R

/**
 * The trip in words, one wording for every surface: the Live Update and the live screen say the
 * same thing at the same moment. [lines] names the rides; a line it lacks shows its bare code.
 */
internal class TripCopy(private val resources: Resources, private val lines: Map<String, LineInfo>) {

    fun rideName(ride: TripLeg.Ride): String = lines[ride.line]?.name ?: ride.line.substringAfter(':')

    fun title(headline: Headline): String = when (headline) {
        is Headline.Board -> resources.getString(R.string.trip_board, rideName(headline.ride))
        is Headline.Change -> resources.getString(R.string.trip_change, rideName(headline.ride))
        is Headline.RideTo -> resources.getString(R.string.trip_ride_to, headline.ride.stops.last().name)
        is Headline.AlightNow -> resources.getString(R.string.trip_alight_now, headline.ride.stops.last().name)
        is Headline.Arrived -> resources.getString(R.string.trip_arrived, headline.destination)
    }

    fun detail(trip: ActiveTrip, headline: Headline): String = when (headline) {
        is Headline.Board -> listOfNotNull(
            headline.ride.headsign?.let { resources.getString(R.string.trip_headsign, it) },
            headline.ride.platformCode?.let { resources.getString(R.string.trip_platform, formatPlatformCode(it)) },
            headline.departsAt?.let { resources.getString(R.string.trip_departs_at, formatClock(it)) }
                ?: resources.getString(R.string.trip_from_stop, headline.ride.stops.first().name),
        ).joinToString(separator)
        is Headline.Change -> listOfNotNull(
            headline.walk?.let { resources.getString(R.string.trip_walk_to, it.to.name, it.distanceM) },
            headline.ride.headsign?.let { resources.getString(R.string.trip_headsign, it) },
            headline.ride.platformCode?.let { resources.getString(R.string.trip_platform, formatPlatformCode(it)) },
            headline.departsAt?.let { resources.getString(R.string.trip_departs_at, formatClock(it)) },
        ).joinToString(separator)
        // Aboard, the line and its direction are the rider's own train: only how far is left.
        is Headline.RideTo -> listOfNotNull(
            resources.getString(
                if (headline.ride.isBus) R.string.trip_haltes_left else R.string.trip_stations_left,
                headline.stopsLeft,
            ),
            headline.alightsAt?.takeIf { trip.state.source != PositionSource.UNKNOWN }
                ?.let { resources.getString(R.string.trip_alights_around, formatClock(it)) },
        ).joinToString(separator)
        is Headline.AlightNow -> headline.then?.let { resources.getString(R.string.trip_then_change, rideName(it)) }
            ?: resources.getString(R.string.trip_then_done)
        is Headline.Arrived -> ""
    }

    /** How the position is known; `null` once arrived, when it no longer matters. */
    fun source(trip: ActiveTrip): String? = when {
        trip.state.phase == TripPhase.ARRIVED -> null
        trip.state.resumed && trip.state.hasLocation && trip.state.source != PositionSource.CONFIRMED ->
            resources.getString(R.string.trip_resumed)
        else -> when (trip.state.source) {
            PositionSource.CONFIRMED -> resources.getString(R.string.trip_source_confirmed)
            PositionSource.ESTIMATED -> resources.getString(R.string.trip_source_estimated)
            PositionSource.UNKNOWN -> resources.getString(R.string.trip_source_unknown)
        }
    }

    /** The status-bar chip: a few characters. */
    fun chip(headline: Headline): String = when (headline) {
        is Headline.Board -> headline.departsAt?.let(::formatClock) ?: resources.getString(R.string.trip_chip_board)
        is Headline.Change -> headline.departsAt?.let(::formatClock) ?: resources.getString(R.string.trip_chip_board)
        is Headline.RideTo -> resources.getString(R.string.trip_chip_stops, headline.stopsLeft)
        is Headline.AlightNow -> resources.getString(R.string.trip_chip_alight)
        is Headline.Arrived -> resources.getString(R.string.trip_chip_arrived)
    }

    val separator: String get() = resources.getString(R.string.trip_separator)
}
