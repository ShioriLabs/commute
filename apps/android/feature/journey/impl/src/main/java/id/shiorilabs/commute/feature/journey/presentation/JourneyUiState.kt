package id.shiorilabs.commute.feature.journey.presentation

import id.shiorilabs.commute.feature.journey.domain.JourneyCriteria
import id.shiorilabs.commute.feature.journey.domain.PairEnd
import id.shiorilabs.commute.feature.journey.domain.PickableStation
import id.shiorilabs.commute.feature.journey.domain.StationPair
import id.shiorilabs.commute.feature.journey.domain.TripAnswer
import id.shiorilabs.commute.feature.station.domain.LineInfo

/** The answer for the chosen pair, or why there is none. */
sealed interface TripState {

    /** Half a pair, or none: nothing to ask yet. */
    data object Idle : TripState

    data object Loading : TripState

    data class Loaded(val answer: TripAnswer) : TripState

    /** A 404: no route between the two, as the web words every one. */
    data object NotFound : TripState

    data object Failed : TripState
}

/** Which of the two result pages shows: the web's `journey-pager.ts`. */
enum class JourneyPage { OPTIONS, DETAIL }

/** One end of the pair as the panel shows it. */
data class PairEndpoint(
    val id: String,
    /** The index's row for it, once the index has loaded and if it knows the id. */
    val station: PickableStation?,
    /** Its name: the index's, else the answer's, else `null` while neither is in. */
    val name: String?,
)

data class JourneyUiState(
    val pair: StationPair = StationPair(),
    val origin: PairEndpoint? = null,
    val destination: PairEndpoint? = null,
    val criteria: JourneyCriteria = JourneyCriteria(),
    val trip: TripState = TripState.Idle,
    val page: JourneyPage = JourneyPage.OPTIONS,
    val selected: Int = 0,
    /** The end the station picker is open for, or `null` when it is closed. */
    val picker: PairEnd? = null,
    /** The line dictionary, keyed `OPERATOR:CODE`. Empty until it loads. */
    val lines: Map<String, LineInfo> = emptyMap(),
    /** The web link for this pair and selected journey; `null` without both ends. */
    val shareUrl: String? = null,
)

/** A pair search's "Rute terakhir" offers back, named from the station index. */
data class RecentRouteRow(
    /** `OPERATOR-CODE`. */
    val fromId: String,
    val toId: String,
    val fromName: String,
    val toName: String,
    /** Pinned to home. */
    val saved: Boolean,
)

/** The picker's list for what the rider has typed, and the quick picks above it. */
data class PickerUiState(
    val query: String = "",
    val stations: List<PickableStation> = emptyList(),
    val quickPicks: List<PickableStation> = emptyList(),
    /** Whether the index is in: an empty list before then is not "not found". */
    val loaded: Boolean = false,
)
