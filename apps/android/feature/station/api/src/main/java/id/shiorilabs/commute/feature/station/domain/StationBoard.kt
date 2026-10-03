package id.shiorilabs.commute.feature.station.domain

import id.shiorilabs.commute.core.type.UIState
import java.time.Instant

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
    /**
     * How often each corridor passes, standing in for the timetable TransJakarta doesn't publish.
     * Only a halte asks for it; everywhere else it stays [UIState.Idle].
     */
    val frequencies: UIState<List<Frequency>> = UIState.Idle,
    /** When the oldest part shown was last confirmed with the API; null until one has been. */
    val updatedAt: Instant? = null,
    /**
     * Whether a part shown is an old copy that couldn't be refreshed when it was due (offline, or
     * the fetch failed): the screen says how old it is rather than pass it off as current.
     */
    val isOutdated: Boolean = false,
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
            frequencies = if (isTransJakarta(stationId)) UIState.Loading else UIState.Idle,
        )
    }
}
