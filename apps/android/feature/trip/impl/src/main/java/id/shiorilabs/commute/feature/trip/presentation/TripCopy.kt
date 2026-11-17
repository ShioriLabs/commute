package id.shiorilabs.commute.feature.trip.presentation

import android.content.res.Resources
import id.shiorilabs.commute.core.time.formatClock
import id.shiorilabs.commute.core.trip.Headline
import id.shiorilabs.commute.core.trip.PositionSource
import id.shiorilabs.commute.core.trip.TripLeg
import id.shiorilabs.commute.core.trip.TripPhase
import id.shiorilabs.commute.core.trip.laterDepartures
import id.shiorilabs.commute.core.tripcopy.R as CopyR
import id.shiorilabs.commute.core.tripcopy.TripWording
import id.shiorilabs.commute.feature.station.domain.LineInfo
import id.shiorilabs.commute.feature.trip.ActiveTrip
import id.shiorilabs.commute.feature.station.domain.formatPlatformCode
import id.shiorilabs.commute.feature.trip.R
import java.time.Instant

/**
 * The trip in words, one wording for every surface: the Live Update and the live screen say the
 * same thing at the same moment. [lines] names the rides; a line it lacks shows its bare code.
 */
internal class TripCopy(private val resources: Resources, private val lines: Map<String, LineInfo>) {

    private val wording = TripWording(resources) { lines[it]?.name }

    fun rideName(ride: TripLeg.Ride): String = wording.rideName(ride)

    fun direction(ride: TripLeg.Ride): String? = wording.direction(ride)

    fun title(headline: Headline): String = wording.title(headline)

    /**
     * The notification's line, as a rider would say it: "Arah Angke, Peron 3·4, berangkat 21.58.
     * Berikutnya 22.08, 22.14". Facts about one thing share a sentence; the trains after, or the
     * next stop, have their own.
     */
    fun detail(trip: ActiveTrip, headline: Headline, now: Instant): String = when (headline) {
        is Headline.Board -> sentences(
            clause(
                direction(headline.ride),
                headline.ride.platformCode?.let { resources.getString(CopyR.string.trip_platform, formatPlatformCode(it)) },
                headline.departsAt?.let { resources.getString(CopyR.string.trip_departs_at, formatClock(it)) }
                    ?: resources.getString(R.string.trip_from_stop, headline.ride.stops.first().name),
            ),
            nextDepartures(headline, now),
        )
        is Headline.Change -> sentences(
            clause(
                walkAndPlatform(headline),
                headline.ride.platformCode?.takeIf { headline.walk == null }
                    ?.let { resources.getString(CopyR.string.trip_platform, formatPlatformCode(it)) },
                headline.departsAt?.let { resources.getString(CopyR.string.trip_departs_at, formatClock(it)) },
            ),
            nextDepartures(headline, now),
        )
        // Aboard, the line and its direction are the rider's own train: where it stops next and how far is left.
        is Headline.RideTo -> sentences(
            // At one stop left the next is the alighting one, which the title already names.
            headline.nextStop?.takeIf { headline.stopsLeft > 1 }
                ?.let { resources.getString(CopyR.string.trip_next_stop, it.name) },
            clause(
                resources.getString(
                    if (headline.ride.isBus) CopyR.string.trip_haltes_left else CopyR.string.trip_stations_left,
                    headline.stopsLeft,
                ),
                headline.alightsAt?.takeIf { trip.state.source != PositionSource.UNKNOWN }
                    ?.let { resources.getString(R.string.trip_alights_around, formatClock(it)) },
            ),
        )
        is Headline.AlightNow -> headline.then?.let { resources.getString(CopyR.string.trip_then_change, rideName(it)) }
            ?: resources.getString(CopyR.string.trip_then_done)
        is Headline.Arrived -> ""
    }


    /** "Jalan ke Sudirman Peron 2": the walk, which ends at the platform the ride leaves from. */
    private fun walkAndPlatform(headline: Headline.Change): String? = headline.walk?.let { walk ->
        headline.ride.platformCode
            ?.let { resources.getString(CopyR.string.trip_walk_to_platform, walk.to.name, resources.getString(CopyR.string.trip_platform, formatPlatformCode(it))) }
            ?: resources.getString(CopyR.string.trip_walk_to, walk.to.name)
    }

    /** "berikutnya 08.22, 08.33": what the rider would board if they missed this one, before they do. */
    private fun nextDepartures(headline: Headline, now: Instant): String? =
        headline.laterDepartures(now).take(NEXT_SHOWN).takeIf { it.isNotEmpty() }
            ?.let { resources.getString(CopyR.string.trip_next_departures, it.joinToString(", ") { time -> formatClock(time) }) }
    /** How the position is known; `null` once arrived, when it no longer matters. */
    fun source(trip: ActiveTrip): String? = when {
        trip.state.phase == TripPhase.ARRIVED -> null
        trip.state.resumed && trip.state.hasLocation && trip.state.source != PositionSource.CONFIRMED ->
            resources.getString(R.string.trip_resumed)
        else -> when (trip.state.source) {
            PositionSource.CONFIRMED -> resources.getString(R.string.trip_source_confirmed)
            PositionSource.ESTIMATED -> resources.getString(CopyR.string.trip_source_estimated)
            PositionSource.UNKNOWN -> resources.getString(CopyR.string.trip_source_unknown)
        }
    }

    /** The status-bar chip: a few characters. */
    fun chip(headline: Headline): String = when (headline) {
        is Headline.Board -> headline.departsAt?.let(::formatClock) ?: resources.getString(CopyR.string.trip_chip_board)
        is Headline.Change -> headline.departsAt?.let(::formatClock) ?: resources.getString(CopyR.string.trip_chip_board)
        is Headline.RideTo -> resources.getString(CopyR.string.trip_chip_stops, headline.stopsLeft)
        is Headline.AlightNow -> resources.getString(CopyR.string.trip_chip_alight)
        is Headline.Arrived -> resources.getString(R.string.trip_chip_arrived)
    }

    /** Facts about one thing, in one sentence: "7 stasiun lagi, sampai sekitar 22.25". `null` when there are none. */
    fun clause(vararg parts: String?): String? = parts.filterNotNull().takeIf { it.isNotEmpty() }?.joinToString(", ")

    /** Sentences, each led by a capital, without the closing full stop the rest of the app's copy leaves off. */
    fun sentences(vararg parts: String?): String =
        parts.filterNotNull().filter { it.isNotEmpty() }.joinToString(". ") { part -> part.replaceFirstChar { it.uppercase() } }

    private companion object {

        /** Later trains named at the end of the detail line: enough to see whether a miss costs five minutes or twenty. */
        const val NEXT_SHOWN = 2
    }
}
