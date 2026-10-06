package id.shiorilabs.commute.feature.station.data.impl

import arrow.core.Either
import id.shiorilabs.commute.core.ext.onDataThread
import id.shiorilabs.commute.core.model.models.GroupedTimetable
import id.shiorilabs.commute.core.model.models.HeadwayRow
import id.shiorilabs.commute.core.model.models.OperatorWithLines
import id.shiorilabs.commute.core.network.service.CommuteService
import id.shiorilabs.commute.core.query.Query
import id.shiorilabs.commute.core.query.QueryClient
import id.shiorilabs.commute.core.query.QueryPolicy
import id.shiorilabs.commute.core.query.QuerySpec
import id.shiorilabs.commute.core.query.Refetched
import id.shiorilabs.commute.core.query.queryKey
import id.shiorilabs.commute.core.time.ServiceDayName
import id.shiorilabs.commute.core.type.Failure
import id.shiorilabs.commute.feature.station.data.LineRepository
import id.shiorilabs.commute.feature.station.data.StationDirectory
import id.shiorilabs.commute.feature.station.data.StationRepository
import id.shiorilabs.commute.feature.station.domain.Frequency
import id.shiorilabs.commute.feature.station.domain.LineInfo
import id.shiorilabs.commute.feature.station.domain.LineTimetable
import id.shiorilabs.commute.feature.station.domain.Station
import id.shiorilabs.commute.feature.station.domain.Transfer
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.flowOn
import kotlinx.coroutines.flow.map
import kotlinx.serialization.builtins.ListSerializer
import javax.inject.Inject
import javax.inject.Singleton
import id.shiorilabs.commute.core.model.models.Station as StationDto
import id.shiorilabs.commute.core.model.models.Transfer as TransferDto

/**
 * Serves stations through the [QueryClient], under keys nested by station (`station/KCI-MRI`,
 * `station/KCI-MRI/timetable/WD`, …), so a station's parts are held, on disk too, and invalidated
 * together. A station and its board for a day type only change with a data deploy, and the home
 * feed has usually just loaded the very station a rider opens, so the station page starts from it.
 *
 * An empty board is kept but counts as stale, so the next look asks again: the screen offers a
 * retry for it, which has to actually ask. An empty list of transfers or frequencies is a stable
 * fact, kept like any other.
 */
@Singleton
class StationRepositoryImpl @Inject constructor(
    private val service: CommuteService,
    private val queries: QueryClient,
) : StationRepository {

    private fun stationQuery(stationId: String): QuerySpec<StationDto> =
        QuerySpec(queryKey(STATION, stationId), StationDto.serializer(), QueryPolicy.Topology) { etag ->
            val (operator, code) = stationId.splitId()
            service.getStation(operator, code, etag)
        }

    private fun timetableQuery(stationId: String, day: ServiceDayName): QuerySpec<List<GroupedTimetable>> =
        QuerySpec(
            key = queryKey(STATION, stationId, "timetable", day.name),
            serializer = ListSerializer(GroupedTimetable.serializer()),
            policy = QueryPolicy.Timetable,
            isUsable = { it.isNotEmpty() },
        ) { etag ->
            val (operator, code) = stationId.splitId()
            service.getGroupedTimetable(operator, code, day.name, etag)
        }

    private fun transfersQuery(stationId: String): QuerySpec<List<TransferDto>> =
        QuerySpec(
            key = queryKey(STATION, stationId, "transfers"),
            serializer = ListSerializer(TransferDto.serializer()),
            policy = QueryPolicy.Topology,
        ) { etag ->
            val (operator, code) = stationId.splitId()
            service.getTransfers(operator, code, etag)
        }

    private fun frequenciesQuery(stationId: String, day: ServiceDayName): QuerySpec<List<HeadwayRow>> =
        QuerySpec(
            key = queryKey(STATION, stationId, "headway", day.name),
            serializer = ListSerializer(HeadwayRow.serializer()),
            policy = QueryPolicy.Topology,
        ) { etag ->
            val (operator, code) = stationId.splitId()
            service.getHeadway(operator, code, day.name, etag)
        }

    override suspend fun station(stationId: String): Either<Failure, Station> =
        queries.fetch(stationQuery(stationId)).mapOnDataThread { it.toStation() }

    override suspend fun timetable(stationId: String, day: ServiceDayName): Either<Failure, List<LineTimetable>> =
        queries.fetch(timetableQuery(stationId, day)).mapOnDataThread { it.toLineTimetables() }

    override suspend fun transfers(stationId: String): Either<Failure, List<Transfer>> =
        queries.fetch(transfersQuery(stationId)).mapOnDataThread { rows -> rows.map { it.toTransfer() } }

    override suspend fun frequencies(stationId: String, day: ServiceDayName): Either<Failure, List<Frequency>> =
        queries.fetch(frequenciesQuery(stationId, day)).mapOnDataThread { it.toFrequencies() }

    override fun observeStation(stationId: String): Flow<Query<Station>> =
        queries.observe(stationQuery(stationId)).mapData { it.toStation() }

    override fun observeTimetable(stationId: String, day: ServiceDayName): Flow<Query<List<LineTimetable>>> =
        queries.observe(timetableQuery(stationId, day)).mapData { it.toLineTimetables() }

    override fun observeFrequencies(stationId: String, day: ServiceDayName): Flow<Query<List<Frequency>>> =
        queries.observe(frequenciesQuery(stationId, day)).mapData { it.toFrequencies() }

    override suspend fun refresh(stationId: String): Refetched =
        queries.refetch(queryKey(STATION, stationId))

    override fun cachedStation(stationId: String): Station? =
        queries.peek(stationQuery(stationId))?.data?.toStation()

    override fun cachedTimetable(stationId: String, day: ServiceDayName): List<LineTimetable>? =
        queries.peek(timetableQuery(stationId, day))?.data?.toLineTimetables()

    override fun cachedTransfers(stationId: String): List<Transfer>? =
        queries.peek(transfersQuery(stationId))?.data?.map { it.toTransfer() }

    override fun cachedFrequencies(stationId: String, day: ServiceDayName): List<Frequency>? =
        queries.peek(frequenciesQuery(stationId, day))?.data?.toFrequencies()

    private fun List<GroupedTimetable>.toLineTimetables(): List<LineTimetable> = map { it.toLineTimetable() }

    private fun List<HeadwayRow>.toFrequencies(): List<Frequency> = map { it.toFrequency() }

    /** `KCI-MRI` to (`KCI`, `MRI`). */
    private fun String.splitId(): Pair<String, String> = substringBefore('-') to substringAfter('-')

    private companion object {

        const val STATION = "station"
    }
}

/**
 * Serves the dictionary through the [QueryClient]: it is small and only changes with a deploy, so
 * it is held a day at a time, on disk too.
 */
@Singleton
class LineRepositoryImpl @Inject constructor(
    private val service: CommuteService,
    private val queries: QueryClient,
) : LineRepository {

    private val linesQuery = QuerySpec(
        key = queryKey("operators"),
        serializer = ListSerializer(OperatorWithLines.serializer()),
        policy = QueryPolicy.Static,
    ) { etag -> service.getOperators(etag) }

    override suspend fun lines(): Either<Failure, Map<String, LineInfo>> =
        queries.fetch(linesQuery).mapOnDataThread { it.toLineDictionary() }

    override fun cachedLines(): Map<String, LineInfo>? = queries.peek(linesQuery)?.data?.toLineDictionary()
}

/**
 * Serves every station in one list through the [QueryClient], held an hour at a time like the rest
 * of the topology. About 13 KB on the wire, so it is fetched whole rather than per station.
 */
@Singleton
class StationDirectoryImpl @Inject constructor(
    private val service: CommuteService,
    private val queries: QueryClient,
) : StationDirectory {

    private val stationsQuery = QuerySpec(
        key = queryKey("stations"),
        serializer = ListSerializer(StationDto.serializer()),
        policy = QueryPolicy.Topology,
        isUsable = { it.isNotEmpty() },
    ) { etag -> service.getStations(etag) }

    override suspend fun all(): Either<Failure, List<Station>> =
        queries.fetch(stationsQuery).mapOnDataThread { rows -> rows.map { it.toStation() } }

    override fun cached(): List<Station>? = queries.peek(stationsQuery)?.data?.map { it.toStation() }

    override suspend fun stored(): List<Station>? =
        queries.observe(stationsQuery).first().data?.let { rows -> onDataThread { rows.map { it.toStation() } } }
}

/** Maps a wire answer to the domain off the main thread: a board can hold thousands of departures. */
private suspend fun <A, B> Either<Failure, A>.mapOnDataThread(transform: (A) -> B): Either<Failure, B> =
    onDataThread { map(transform) }

private fun <A, B> Flow<Query<A>>.mapData(transform: (A) -> B): Flow<Query<B>> =
    map { it.map(transform) }.flowOn(Dispatchers.Default)
