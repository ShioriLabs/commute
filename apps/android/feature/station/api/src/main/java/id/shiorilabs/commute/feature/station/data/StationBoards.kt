package id.shiorilabs.commute.feature.station.data

import id.shiorilabs.commute.core.query.toUIState
import id.shiorilabs.commute.core.time.nextServiceDayOf
import id.shiorilabs.commute.core.time.serviceDayOf
import id.shiorilabs.commute.core.type.UIState
import id.shiorilabs.commute.feature.station.domain.LineTimetable
import id.shiorilabs.commute.feature.station.domain.StationBoard
import id.shiorilabs.commute.feature.station.domain.isTransJakarta
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.flowOf
import java.time.LocalDateTime

/**
 * [stationId]'s board for the service day running at [now], as its parts load and refresh: the
 * station, today's board, a halte's frequencies and the next day's board, each from what is held
 * first (however old) and then from the network when it was due.
 *
 * The station is always applied first: it carries the lines the board's skeleton is shaped after,
 * so today's board shows as loading until the station has settled. The next day's board is only
 * asked for when tomorrow runs a different one; the rest of the week today's already holds
 * tomorrow's first trains. Frequencies are only asked for at a TransJakarta halte, as on the web: a
 * rail station has a real board and never pays for the request. They are [now]'s hour's, so a
 * halte's board is collected afresh when the hour turns (see [boardHour]).
 *
 * Doesn't complete while its parts are cached ones; a collector cancels it.
 */
fun StationRepository.board(stationId: String, now: LocalDateTime): Flow<StationBoard> {
    val day = serviceDayOf(now)
    val nextDay = nextServiceDayOf(now)
    val halte = isTransJakarta(stationId)
    // A halte's timetable is a 404 on the API, so it is never asked for, today's or tomorrow's:
    // its frequencies are its board, as on the web.
    val today = if (halte) flowOf(null) else timetable(stationId, day).observe()
    val nextBoard = if (nextDay != day && !halte) timetable(stationId, nextDay).observe() else flowOf(null)
    val frequencies = if (halte) frequencies(stationId, day, now.hour).observe() else flowOf(null)

    return combine(
        station(stationId).observe(),
        today,
        nextBoard,
        frequencies,
    ) { station, timetable, next, frequency ->
        val stationState = station.toUIState()
        val shown = listOfNotNull(station, timetable, frequency)
        StationBoard(
            stationId = stationId,
            station = stationState,
            timetable = when {
                stationState is UIState.Loading -> UIState.Loading
                // A halte's is the empty one it really is, with its frequencies standing in.
                timetable == null -> UIState.Success(emptyList())
                else -> timetable.toUIState()
            },
            nextDayBoard = next?.data?.associateBy { it.lineKey },
            nextDayDiffers = nextDay != day,
            frequencies = frequency?.toUIState() ?: UIState.Idle,
            updatedAt = shown.mapNotNull { it.updatedAt }.minOrNull(),
            isOutdated = shown.any { it.isOutdated },
        )
    }.distinctUntilChanged()
}

/**
 * [stationId]'s board for the service day running at [now] from what has already been loaded this
 * session, or null when the station or today's board hasn't been (a halte's board is its
 * frequencies, which fill in when held and are otherwise left [UIState.Loading] for [board] to
 * fill). The next day's board is filled in when it is there too; without it the board is still
 * whole enough to show.
 */
fun StationRepository.cachedBoard(stationId: String, now: LocalDateTime): StationBoard? {
    val day = serviceDayOf(now)
    val nextDay = nextServiceDayOf(now)
    val halte = isTransJakarta(stationId)
    val station = station(stationId).cached() ?: return null
    // A halte has no timetable to hold: it is the empty one it really is.
    val timetable = if (halte) emptyList<LineTimetable>() else timetable(stationId, day).cached() ?: return null
    return StationBoard(
        stationId = stationId,
        station = UIState.Success(station),
        timetable = UIState.Success(timetable),
        nextDayBoard = if (nextDay != day && !halte) {
            timetable(stationId, nextDay).cached()?.associateBy { it.lineKey }
        } else {
            null
        },
        nextDayDiffers = nextDay != day,
        frequencies = if (halte) {
            frequencies(stationId, day, now.hour).cached()?.let { UIState.Success(it) } ?: UIState.Loading
        } else {
            UIState.Idle
        },
    )
}

/**
 * The hour [board] was asked for, as far as it matters: [now]'s hour at a TransJakarta halte, whose
 * frequencies change with it, and null at a rail station, whose board holds all day. A screen
 * collects the board afresh when this changes, as it does when the service day turns.
 */
fun boardHour(stationId: String, now: LocalDateTime): Int? = if (isTransJakarta(stationId)) now.hour else null
