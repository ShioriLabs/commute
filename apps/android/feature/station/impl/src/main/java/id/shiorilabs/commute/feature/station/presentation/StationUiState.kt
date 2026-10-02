package id.shiorilabs.commute.feature.station.presentation

import id.shiorilabs.commute.feature.station.domain.LineInfo
import id.shiorilabs.commute.feature.station.domain.StationBoard

/** The station page: the station and its board, the line dictionary, and whether it's pinned. */
data class StationUiState(
    val board: StationBoard,
    /** Keyed `OPERATOR:CODE`. Empty until it loads; roundels and cards render grey until then. */
    val lines: Map<String, LineInfo>,
    /** Saved to the home screen. */
    val saved: Boolean,
)
