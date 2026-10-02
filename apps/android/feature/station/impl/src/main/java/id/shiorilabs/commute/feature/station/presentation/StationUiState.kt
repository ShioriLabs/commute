package id.shiorilabs.commute.feature.station.presentation

import id.shiorilabs.commute.core.type.UIState
import id.shiorilabs.commute.feature.station.domain.LineInfo
import id.shiorilabs.commute.feature.station.domain.StationBoard
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
)
