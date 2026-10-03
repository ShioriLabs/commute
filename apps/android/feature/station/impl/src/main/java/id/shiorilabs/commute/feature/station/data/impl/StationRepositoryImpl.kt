package id.shiorilabs.commute.feature.station.data.impl

import arrow.core.Either
import arrow.core.right
import id.shiorilabs.commute.core.ext.apiCallToFailure
import id.shiorilabs.commute.core.network.service.CommuteService
import id.shiorilabs.commute.core.time.ServiceDayName
import id.shiorilabs.commute.core.type.Failure
import id.shiorilabs.commute.core.type.requireBody
import id.shiorilabs.commute.feature.station.data.LineRepository
import id.shiorilabs.commute.feature.station.data.StationRepository
import id.shiorilabs.commute.feature.station.domain.Frequency
import id.shiorilabs.commute.feature.station.domain.LineInfo
import id.shiorilabs.commute.feature.station.domain.LineTimetable
import id.shiorilabs.commute.feature.station.domain.Station
import id.shiorilabs.commute.feature.station.domain.Transfer
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.util.concurrent.ConcurrentHashMap
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Holds what it has fetched in memory for the session. A station and its board for a day type only
 * change with a data deploy, and the home feed has usually just loaded the very station a rider
 * opens, so the station page can start from it. A failure or an empty board is not cached, so the
 * next call tries again.
 */
@Singleton
class StationRepositoryImpl @Inject constructor(
    private val service: CommuteService,
) : StationRepository {

    private val stations = ConcurrentHashMap<String, Station>()
    private val timetables = ConcurrentHashMap<Pair<String, ServiceDayName>, List<LineTimetable>>()
    private val transfers = ConcurrentHashMap<String, List<Transfer>>()
    private val frequencies = ConcurrentHashMap<Pair<String, ServiceDayName>, List<Frequency>>()

    override suspend fun station(stationId: String): Either<Failure, Station> =
        stations[stationId]?.right() ?: apiCallToFailure {
            val (operator, code) = stationId.splitId()
            service.getStation(operator, code).requireBody().toStation()
        }.onRight { stations[stationId] = it }

    override suspend fun timetable(stationId: String, day: ServiceDayName): Either<Failure, List<LineTimetable>> =
        timetables[stationId to day]?.right() ?: apiCallToFailure {
            val (operator, code) = stationId.splitId()
            service.getGroupedTimetable(operator, code, day.name).requireBody().map { it.toLineTimetable() }
        }.onRight { lines ->
            // An empty board is offered a retry on screen, which has to actually ask again.
            if (lines.isNotEmpty()) {
                timetables[stationId to day] = lines
            }
        }

    // An empty list is kept like any other: a station with no transfers is a stable fact, and the
    // page offers no retry for it.
    override suspend fun transfers(stationId: String): Either<Failure, List<Transfer>> =
        transfers[stationId]?.right() ?: apiCallToFailure {
            val (operator, code) = stationId.splitId()
            service.getTransfers(operator, code).requireBody().map { it.toTransfer() }
        }.onRight { transfers[stationId] = it }

    // An empty list is kept too: a halte the model has no figures for falls back to the no-schedule
    // note, which offers no retry either.
    override suspend fun frequencies(stationId: String, day: ServiceDayName): Either<Failure, List<Frequency>> =
        frequencies[stationId to day]?.right() ?: apiCallToFailure {
            val (operator, code) = stationId.splitId()
            service.getHeadway(operator, code, day.name).requireBody().map { it.toFrequency() }
        }.onRight { frequencies[stationId to day] = it }

    override fun cachedStation(stationId: String): Station? = stations[stationId]

    override fun cachedTimetable(stationId: String, day: ServiceDayName): List<LineTimetable>? =
        timetables[stationId to day]

    override fun cachedTransfers(stationId: String): List<Transfer>? = transfers[stationId]

    override fun cachedFrequencies(stationId: String, day: ServiceDayName): List<Frequency>? =
        frequencies[stationId to day]

    /** `KCI-MRI` to (`KCI`, `MRI`). */
    private fun String.splitId(): Pair<String, String> = substringBefore('-') to substringAfter('-')
}

/**
 * Holds the dictionary in memory once fetched: it is small and only changes with a deploy. A
 * failure is not cached, so the next call tries again.
 */
@Singleton
class LineRepositoryImpl @Inject constructor(
    private val service: CommuteService,
) : LineRepository {

    private val mutex = Mutex()
    @Volatile
    private var cached: Map<String, LineInfo>? = null

    override suspend fun lines(): Either<Failure, Map<String, LineInfo>> = mutex.withLock {
        cached?.right() ?: apiCallToFailure {
            service.getOperators().requireBody().toLineDictionary()
        }.onRight { cached = it }
    }

    override fun cachedLines(): Map<String, LineInfo>? = cached
}
