package id.shiorilabs.commute.feature.saved.presentation

import id.shiorilabs.commute.feature.station.domain.LineInfo
import id.shiorilabs.commute.feature.station.domain.StationBoard

/** Something on the home feed: a pinned station's board, or a pinned Dari→Ke pair. */
sealed interface HomeEntry {

    /** Stable across loads, for the feed's item keys. */
    val key: String

    data class StationEntry(val board: StationBoard) : HomeEntry {
        override val key: String get() = "station:${board.stationId}"
    }

    /**
     * A pair, titled by its stations' names. The names come from the station index of each end,
     * `null` until they load; the card under the title asks for its own trips.
     */
    data class RouteEntry(
        val fromId: String,
        val toId: String,
        val fromName: String? = null,
        val toName: String? = null,
    ) : HomeEntry {
        override val key: String get() = "route:$fromId>$toId"
    }
}

/** The home feed: what the rider pinned, in their order, and the line dictionary. */
data class SavedStationsUiState(
    val entries: List<HomeEntry>,
    /** Keyed `OPERATOR:CODE`. Empty until it loads; the cards render grey until then. */
    val lines: Map<String, LineInfo>,
) {

    /** The pinned stations' boards alone, in order. */
    val stationBoards: List<StationBoard> get() = entries.mapNotNull { (it as? HomeEntry.StationEntry)?.board }
}
