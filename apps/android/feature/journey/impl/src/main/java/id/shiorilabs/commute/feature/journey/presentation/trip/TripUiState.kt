package id.shiorilabs.commute.feature.journey.presentation.trip

import id.shiorilabs.commute.feature.journey.domain.Journey
import id.shiorilabs.commute.feature.station.domain.LineInfo
import java.time.Instant

/** The journey the trip page was opened on, or why it can't be shown. */
sealed interface TripPageState {

    data object Loading : TripPageState

    /**
     * @property updatedAt When the answer [journey] comes from was last confirmed with the API.
     * @property isOutdated That answer is an old one that couldn't be refreshed (offline, or the
     *   fetch failed): say how old it is.
     */
    data class Loaded(
        val journey: Journey,
        val updatedAt: Instant? = null,
        val isOutdated: Boolean = false,
    ) : TripPageState

    /** The pair still answers, but no longer with this journey's route: its options are offered. */
    data object Gone : TripPageState

    /** A 404: no route between the two at all. */
    data object NotFound : TripPageState

    data object Failed : TripPageState
}

data class TripUiState(
    val trip: TripPageState = TripPageState.Loading,
    /** The line dictionary, keyed `OPERATOR:CODE`. Empty until it loads. */
    val lines: Map<String, LineInfo> = emptyMap(),
    /** The web link for this journey; `null` until the criteria are read. */
    val shareUrl: String? = null,
)
