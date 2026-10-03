package id.shiorilabs.commute.feature.station.data

import arrow.core.Either
import id.shiorilabs.commute.core.query.Query
import id.shiorilabs.commute.core.query.Refetched
import id.shiorilabs.commute.core.query.queryOnce
import id.shiorilabs.commute.core.time.ServiceDayName
import id.shiorilabs.commute.core.type.Failure
import id.shiorilabs.commute.feature.station.domain.Frequency
import id.shiorilabs.commute.feature.station.domain.LineInfo
import id.shiorilabs.commute.feature.station.domain.LineTimetable
import id.shiorilabs.commute.feature.station.domain.Station
import id.shiorilabs.commute.feature.station.domain.Transfer
import kotlinx.coroutines.flow.Flow

/**
 * Stations and their boards. Answers are cached, on disk too, so the suspend calls answer at once
 * while what they hold is fresh, and fall back to an older copy when the network fails; only with
 * nothing held is the failure returned.
 */
interface StationRepository {

    /** The station with id `OPERATOR-CODE`. */
    suspend fun station(stationId: String): Either<Failure, Station>

    /** The station's departures on [day], one entry per line that runs then. */
    suspend fun timetable(stationId: String, day: ServiceDayName): Either<Failure, List<LineTimetable>>

    /** The stations a rider can walk to from this one, nearest first as the API orders them. */
    suspend fun transfers(stationId: String): Either<Failure, List<Transfer>>

    /** How often each line passes the station on [day], in the API's order. Not a schedule. */
    suspend fun frequencies(stationId: String, day: ServiceDayName): Either<Failure, List<Frequency>>

    // The observe calls are stale-while-revalidate: what is held first, however old, then a fresh
    // answer if it was due one. They don't complete. The defaults serve an implementation with no
    // cache of its own (a test's fake) from the suspend calls.

    /** [station], as it changes. */
    fun observeStation(stationId: String): Flow<Query<Station>> =
        queryOnce(cachedStation(stationId)) { station(stationId) }

    /** [timetable], as it changes. */
    fun observeTimetable(stationId: String, day: ServiceDayName): Flow<Query<List<LineTimetable>>> =
        queryOnce(cachedTimetable(stationId, day)) { timetable(stationId, day) }

    /** [frequencies], as they change. */
    fun observeFrequencies(stationId: String, day: ServiceDayName): Flow<Query<List<Frequency>>> =
        queryOnce(cachedFrequencies(stationId, day)) { frequencies(stationId, day) }

    /**
     * Asks again for every part of [stationId] being observed (the station, its boards, a halte's
     * frequencies), whatever their age, and once they are in (at once offline) says what they found.
     * A pull to refresh.
     */
    suspend fun refresh(stationId: String): Refetched = Refetched()

    /**
     * The station as already loaded this session, without asking or reading the disk. A screen
     * opening onto data another one just loaded starts from it, rather than from a skeleton.
     */
    fun cachedStation(stationId: String): Station? = null

    /** [timetable] as already loaded this session, without asking. */
    fun cachedTimetable(stationId: String, day: ServiceDayName): List<LineTimetable>? = null

    /** [transfers] as already loaded this session, without asking. */
    fun cachedTransfers(stationId: String): List<Transfer>? = null

    /** [frequencies] as already loaded this session, without asking. */
    fun cachedFrequencies(stationId: String, day: ServiceDayName): List<Frequency>? = null
}

interface LineRepository {

    /**
     * The line dictionary, keyed `OPERATOR:CODE`. Responses refer to lines by key, and this is
     * where the keys resolve to a name and a colour. Cached like the rest, for a day at a time.
     */
    suspend fun lines(): Either<Failure, Map<String, LineInfo>>

    /** The dictionary if it has been loaded this session, without asking. */
    fun cachedLines(): Map<String, LineInfo>? = null
}
