package id.shiorilabs.commute.feature.station.presentation

import androidx.annotation.StringRes
import id.shiorilabs.commute.feature.station.R

/**
 * A station the data knows but no commuter train serves, shown as a notice in place of its page:
 * the web's `lib/unserved-stations.ts`. Nothing is fetched for one.
 */
data class UnservedStation(
    @StringRes val name: Int,
    @StringRes val title: Int,
    @StringRes val message: Int,
)

/**
 * A station trains no longer call at, with its page still shown under a notice that says so, and
 * where to go instead: the web's `lib/retired-stations.ts`.
 */
data class RetiredStation(
    @StringRes val message: Int,
    val redirect: Redirect? = null,
) {

    /** The station that took over, by its `OPERATOR-CODE` id. */
    data class Redirect(
        @StringRes val label: Int,
        val stationId: String,
    )
}

private val UNSERVED_STATIONS = mapOf(
    "KCI-GMR" to UnservedStation(
        name = R.string.station_unserved_gambir_name,
        title = R.string.station_unserved_gambir_title,
        message = R.string.station_unserved_gambir_message,
    ),
)

private val RETIRED_STATIONS = mapOf(
    "KCI-KAT" to RetiredStation(
        message = R.string.station_retired_karet_message,
        redirect = RetiredStation.Redirect(R.string.station_retired_karet_redirect, "KCI-SUDB"),
    ),
)

/** Case-folded, as a hand-typed link's id may not be. */
fun unservedStation(stationId: String): UnservedStation? = UNSERVED_STATIONS[stationId.uppercase()]

fun retiredStation(stationId: String): RetiredStation? = RETIRED_STATIONS[stationId.uppercase()]
