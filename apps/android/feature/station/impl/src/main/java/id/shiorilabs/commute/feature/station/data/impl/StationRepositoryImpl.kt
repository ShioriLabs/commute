package id.shiorilabs.commute.feature.station.data.impl

import arrow.core.Either
import arrow.core.right
import id.shiorilabs.commute.core.ext.apiCallToFailure
import id.shiorilabs.commute.core.network.service.CommuteService
import id.shiorilabs.commute.core.time.ServiceDayName
import id.shiorilabs.commute.core.type.Failure
import id.shiorilabs.commute.feature.station.data.LineRepository
import id.shiorilabs.commute.feature.station.data.StationRepository
import id.shiorilabs.commute.feature.station.domain.LineInfo
import id.shiorilabs.commute.feature.station.domain.LineTimetable
import id.shiorilabs.commute.feature.station.domain.Station
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import javax.inject.Inject
import javax.inject.Singleton

class StationRepositoryImpl @Inject constructor(
    private val service: CommuteService,
) : StationRepository {

    override suspend fun station(stationId: String): Either<Failure, Station> = apiCallToFailure {
        val (operator, code) = stationId.splitId()
        service.getStation(operator, code).data.toStation()
    }

    override suspend fun timetable(stationId: String, day: ServiceDayName): Either<Failure, List<LineTimetable>> =
        apiCallToFailure {
            val (operator, code) = stationId.splitId()
            service.getGroupedTimetable(operator, code, day.name).data.map { it.toLineTimetable() }
        }

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
    private var cached: Map<String, LineInfo>? = null

    override suspend fun lines(): Either<Failure, Map<String, LineInfo>> = mutex.withLock {
        cached?.right() ?: apiCallToFailure {
            service.getOperators().data.toLineDictionary()
        }.onRight { cached = it }
    }
}
