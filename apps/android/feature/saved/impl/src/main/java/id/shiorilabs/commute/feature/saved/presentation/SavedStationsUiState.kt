package id.shiorilabs.commute.feature.saved.presentation

import id.shiorilabs.commute.core.query.Refetched
import id.shiorilabs.commute.core.type.UIState
import id.shiorilabs.commute.feature.station.domain.LineInfo
import id.shiorilabs.commute.feature.station.domain.StationBoard
import java.time.Instant

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

/**
 * What a pull to refresh found, counted by feed entry (a station with all its boards is one), so
 * the rider knows whether it did anything: pull to refresh is otherwise a spinner and a shrug.
 */
sealed interface RefreshNotice {

    /** Every entry answered with what it already had. */
    data object UpToDate : RefreshNotice

    /** [count] entries answered with something new. */
    data class Updated(val count: Int) : RefreshNotice

    /** Some entries couldn't be refreshed (offline, or the API failed); [all] when none could. */
    data class Failed(val all: Boolean) : RefreshNotice

    companion object {

        /** The notice for one refetch per entry; null for an empty feed, where nothing was asked. */
        fun of(entries: List<Refetched>): RefreshNotice? {
            if (entries.isEmpty()) return null
            val failed = entries.count { it.changed == 0 && it.failed > 0 }
            val changed = entries.count { it.changed > 0 }
            return when {
                failed > 0 -> Failed(all = failed == entries.size)
                changed > 0 -> Updated(changed)
                else -> UpToDate
            }
        }
    }
}

/** The home feed: what the rider pinned, in their order, and the line dictionary. */
data class SavedStationsUiState(
    val entries: List<HomeEntry>,
    /** Keyed `OPERATOR:CODE`. Empty until it loads; the cards render grey until then. */
    val lines: Map<String, LineInfo>,
    /** A pull to refresh is running: the spinner holds until every entry has answered. */
    val isRefreshing: Boolean = false,
    /** What the last pull to refresh found, until the screen has shown it. */
    val refreshNotice: RefreshNotice? = null,
) {

    /** The pinned stations' boards alone, in order. */
    val stationBoards: List<StationBoard> get() = entries.mapNotNull { (it as? HomeEntry.StationEntry)?.board }

    /** Whether a board shown couldn't be refreshed when it was due. */
    val isOutdated: Boolean get() = stationBoards.any { it.isOutdated }

    /**
     * Whether what the feed opens on is still loading: a station's board, or a pinned pair's
     * station names. The splash waits for it rather than reveal skeletons and "… → …" titles.
     */
    val isFirstContentLoading: Boolean
        get() = stationBoards.any { it.station is UIState.Loading || it.timetable is UIState.Loading } ||
            entries.any { it is HomeEntry.RouteEntry && (it.fromName == null || it.toName == null) }

    /** When the oldest board shown was last confirmed, for the feed's "last updated" line. */
    val oldestUpdate: Instant? get() = stationBoards.mapNotNull { it.updatedAt }.minOrNull()
}
