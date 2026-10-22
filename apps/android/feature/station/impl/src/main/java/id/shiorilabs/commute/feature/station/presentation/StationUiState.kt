package id.shiorilabs.commute.feature.station.presentation

import id.shiorilabs.commute.core.type.UIState
import id.shiorilabs.commute.feature.station.domain.CrowdForecast
import id.shiorilabs.commute.feature.station.domain.LineInfo
import id.shiorilabs.commute.feature.station.domain.StationBoard
import id.shiorilabs.commute.feature.station.domain.StationExit
import id.shiorilabs.commute.feature.station.domain.Transfer

/**
 * The station page: the station and its board, the line dictionary, whether it's pinned, and the
 * stations a rider can walk to from it.
 */
data class StationUiState(
    val board: StationBoard,
    /** Keyed `OPERATOR:CODE`. Empty until it loads; roundels and cards render grey until then. */
    val lines: Map<String, LineInfo>,
    /** Saved to the home screen. */
    val saved: Boolean,
    /** Shown only once loaded and not empty: a failure leaves the section out, as on the web. */
    val transfers: UIState<List<Transfer>> = UIState.Idle,
    /** Set for a station no commuter train serves: its notice stands in for the whole page. */
    val unserved: UnservedStation? = null,
    /** Set for a station trains no longer call at: a notice over its page. */
    val retired: RetiredStation? = null,
    /** How crowded the station usually is, hour by hour. Null while loading, at a halte, or on failure. */
    val crowding: CrowdForecast? = null,
    /** The exits and their signs. Empty while loading, on failure, and for most stations, which is "not yet": the page leaves the section out. */
    val exits: List<StationExit> = emptyList(),
)
