package id.shiorilabs.commute.feature.journey.presentation

import id.shiorilabs.commute.feature.journey.domain.JourneyCriteria
import id.shiorilabs.commute.feature.journey.domain.PairEnd
import id.shiorilabs.commute.feature.journey.domain.PickableStation
import id.shiorilabs.commute.feature.journey.domain.StationPair
import id.shiorilabs.commute.feature.journey.domain.TripAnswer
import id.shiorilabs.commute.feature.station.domain.LineInfo
import java.time.Instant

/** The answer for the chosen pair, or why there is none. */
sealed interface TripState {

    /** Half a pair, or none: nothing to ask yet. */
    data object Idle : TripState

    data object Loading : TripState

    /**
     * @property isRefreshing A fresh answer is on its way; this one is the last held.
     * @property updatedAt When [answer] was last confirmed with the API.
     * @property isOutdated [answer] is an old one that couldn't be refreshed (offline, or the
     *   fetch failed): say how old it is.
     */
    data class Loaded(
        val answer: TripAnswer,
        val isRefreshing: Boolean = false,
        val updatedAt: Instant? = null,
        val isOutdated: Boolean = false,
    ) : TripState

    /** A 404: no route between the two, as the web words every one. */
    data object NotFound : TripState

    data object Failed : TripState
}

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
    /** The end the station picker is open for, or `null` when it is closed. */
    val picker: PairEnd? = null,
    /** The line dictionary, keyed `OPERATOR:CODE`. Empty until it loads. */
    val lines: Map<String, LineInfo> = emptyMap(),
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
    /** "Pakai lokasi kamu": the stations around the rider, once they've asked. */
    val nearby: NearbyPicks = NearbyPicks.Idle,
)

/** The picker's stations near the rider, which it only looks for when asked. */
sealed interface NearbyPicks {

    data object Idle : NearbyPicks

    /** Turned off in Pengaturan → Lokasi: the picker doesn't offer it. */
    data object Off : NearbyPicks

    data object Locating : NearbyPicks

    /** Nearest first, with how far each is in metres. */
    data class Found(val stations: List<Pair<PickableStation, Int>>) : NearbyPicks

    /** Located, but nothing within walking distance. */
    data object NoneNearby : NearbyPicks

    /** No fix: location off, refused, or nothing answered in time. */
    data object Unavailable : NearbyPicks
}
