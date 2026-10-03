package id.shiorilabs.commute.feature.station.data

import id.shiorilabs.commute.core.query.Query
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
 * rail station has a real board and never pays for the request.
 *
 * Doesn't complete while its parts are cached ones; a collector cancels it.
 */
fun StationRepository.board(stationId: String, now: LocalDateTime): Flow<StationBoard> {
    val day = serviceDayOf(now)
    val nextDay = nextServiceDayOf(now)
    val halte = isTransJakarta(stationId)
    val nextBoard = if (nextDay != day) observeTimetable(stationId, nextDay) else flowOf(null)
    val frequencies = if (halte) observeFrequencies(stationId, day) else flowOf(null)

    return combine(
        observeStation(stationId),
        observeTimetable(stationId, day),
        nextBoard,
        frequencies,
    ) { station, timetable, next, frequency ->
        val stationState = station.toUIState()
        val shown = listOfNotNull(station, timetable.takeUnless { halte }, frequency)
        StationBoard(
            stationId = stationId,
            station = stationState,
            timetable = if (stationState is UIState.Loading) UIState.Loading else timetable.toBoardState(halte),
            nextDayBoard = next?.data?.associateBy { it.lineKey },
            nextDayDiffers = nextDay != day,
            frequencies = frequency?.toUIState() ?: UIState.Idle,
            updatedAt = shown.mapNotNull { it.updatedAt }.minOrNull(),
            isOutdated = shown.any { it.isOutdated },
        )
    }.distinctUntilChanged()
}

/**
 * The API answers a halte's timetable with a 404 ("not available yet"), so for TransJakarta a
 * failed board is the empty one it really is, as the web treats it: its frequencies stand in.
 */
private fun Query<List<LineTimetable>>.toBoardState(halte: Boolean): UIState<List<LineTimetable>> =
    if (halte && data == null && failure != null) UIState.Success(emptyList()) else toUIState()

/**
 * [stationId]'s board for the service day running at [now] from what has already been loaded this
 * session, or null when the station or today's board hasn't been. The next day's board and a
 * halte's frequencies are filled in when they are there too; without them the board is still whole
 * enough to show, and a halte's frequencies are left [UIState.Loading] for [board] to fill.
 */
fun StationRepository.cachedBoard(stationId: String, now: LocalDateTime): StationBoard? {
    val day = serviceDayOf(now)
    val nextDay = nextServiceDayOf(now)
    val station = cachedStation(stationId) ?: return null
    val timetable = cachedTimetable(stationId, day) ?: return null
    return StationBoard(
        stationId = stationId,
        station = UIState.Success(station),
        timetable = UIState.Success(timetable),
        nextDayBoard = if (nextDay != day) cachedTimetable(stationId, nextDay)?.associateBy { it.lineKey } else null,
        nextDayDiffers = nextDay != day,
        frequencies = if (isTransJakarta(stationId)) {
            cachedFrequencies(stationId, day)?.let { UIState.Success(it) } ?: UIState.Loading
        } else {
            UIState.Idle
        },
    )
}
