package id.shiorilabs.commute.feature.saved.presentation

import id.shiorilabs.commute.core.type.UIState
import id.shiorilabs.commute.feature.station.domain.LineInfo
import id.shiorilabs.commute.feature.station.domain.LineTimetable
import id.shiorilabs.commute.feature.station.domain.Station

/** One saved station's card on the home feed. */
data class StationCardState(
    /** `OPERATOR-CODE`. */
    val stationId: String,
    val station: UIState<Station>,
    /** Today's service-day board, one entry per line. */
    val timetable: UIState<List<LineTimetable>>,
    /**
     * The next service day's board by line key, for "mulai lagi" once a line has finished. Null when
     * the next day runs the same board, or while it loads, or when it failed: a missing restart
     * only means the row says when the line ended instead.
     */
    val nextDayBoard: Map<String, LineTimetable>?,
    /** Whether the next service day differs from today's; when it doesn't, today's board serves. */
    val nextDayDiffers: Boolean,
) {

    /** The same line on the next service day's board, or null where the board doesn't know it. */
    fun nextDayLine(line: LineTimetable): LineTimetable? =
        if (nextDayDiffers) nextDayBoard?.get(line.lineKey) else line

    companion object {

        fun loading(stationId: String) = StationCardState(
            stationId = stationId,
            station = UIState.Loading,
            timetable = UIState.Loading,
            nextDayBoard = null,
            nextDayDiffers = false,
        )
    }
}

/** The home feed: a card per saved station, in the rider's order, and the line dictionary. */
data class SavedStationsUiState(
    val cards: List<StationCardState>,
    /** Keyed `OPERATOR:CODE`. Empty until it loads; the cards render grey until then. */
    val lines: Map<String, LineInfo>,
)
