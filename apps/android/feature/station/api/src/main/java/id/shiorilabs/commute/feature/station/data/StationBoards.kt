package id.shiorilabs.commute.feature.station.data

import id.shiorilabs.commute.core.time.nextServiceDayOf
import id.shiorilabs.commute.core.time.serviceDayOf
import id.shiorilabs.commute.core.type.UIState
import id.shiorilabs.commute.core.type.toUserMessage
import id.shiorilabs.commute.feature.station.domain.StationBoard
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.channelFlow
import java.time.LocalDateTime

/**
 * Loads [stationId]'s board for the service day running at [now], emitting as each part lands: the
 * loading state first, then the station, then today's board, then the next day's.
 *
 * Starts from [cachedBoard] instead of the loading state where there is one, and when that already
 * holds everything, emits it alone without asking for anything.
 *
 * The station and both boards are fetched together, but the station is always applied first: it
 * carries the lines the board's skeleton is shaped after. The next day's board is only fetched when
 * tomorrow runs a different one; the rest of the week today's already holds tomorrow's first trains.
 */
fun StationRepository.board(stationId: String, now: LocalDateTime): Flow<StationBoard> = channelFlow {
    val day = serviceDayOf(now)
    val nextDay = nextServiceDayOf(now)

    val cached = cachedBoard(stationId, now)
    if (cached != null && (!cached.nextDayDiffers || cached.nextDayBoard != null)) {
        send(cached)
        return@channelFlow
    }

    var board = cached ?: StationBoard.loading(stationId).copy(nextDayDiffers = nextDay != day)
    send(board)

    val station = async { station(stationId) }
    val timetable = async { timetable(stationId, day) }
    val nextBoard = if (nextDay != day) async { timetable(stationId, nextDay) } else null

    board = board.copy(
        station = station.await().fold(
            ifLeft = { UIState.Error(it.toUserMessage(), it.cause) },
            ifRight = { UIState.Success(it) },
        ),
    )
    send(board)

    board = board.copy(
        timetable = timetable.await().fold(
            ifLeft = { UIState.Error(it.toUserMessage(), it.cause) },
            ifRight = { UIState.Success(it) },
        ),
    )
    send(board)

    if (nextBoard != null) {
        board = board.copy(nextDayBoard = nextBoard.await().getOrNull()?.associateBy { it.lineKey })
        send(board)
    }
}

/**
 * [stationId]'s board for the service day running at [now] from what has already been fetched, or
 * null when the station or today's board hasn't been. The next day's board is filled in when it is
 * there too; without it the board is still whole enough to show.
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
    )
}
