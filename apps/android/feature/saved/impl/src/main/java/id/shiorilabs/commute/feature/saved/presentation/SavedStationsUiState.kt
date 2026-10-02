package id.shiorilabs.commute.feature.saved.presentation

import id.shiorilabs.commute.feature.station.domain.LineInfo
import id.shiorilabs.commute.feature.station.domain.StationBoard

/** The home feed: a card per saved station, in the rider's order, and the line dictionary. */
data class SavedStationsUiState(
    val cards: List<StationBoard>,
    /** Keyed `OPERATOR:CODE`. Empty until it loads; the cards render grey until then. */
    val lines: Map<String, LineInfo>,
)
