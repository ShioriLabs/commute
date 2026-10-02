package id.shiorilabs.commute.feature.station.domain

import id.shiorilabs.commute.core.type.UIState

/** A station and its departure board, as the home feed's cards and the station page show them. */
data class StationBoard(
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

        fun loading(stationId: String) = StationBoard(
            stationId = stationId,
            station = UIState.Loading,
            timetable = UIState.Loading,
            nextDayBoard = null,
            nextDayDiffers = false,
        )
    }
}
