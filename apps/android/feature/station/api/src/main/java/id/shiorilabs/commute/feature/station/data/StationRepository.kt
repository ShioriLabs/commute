package id.shiorilabs.commute.feature.station.data

import arrow.core.Either
import id.shiorilabs.commute.core.time.ServiceDayName
import id.shiorilabs.commute.core.type.Failure
import id.shiorilabs.commute.feature.station.domain.Frequency
import id.shiorilabs.commute.feature.station.domain.LineInfo
import id.shiorilabs.commute.feature.station.domain.LineTimetable
import id.shiorilabs.commute.feature.station.domain.Station
import id.shiorilabs.commute.feature.station.domain.Transfer

interface StationRepository {

    /** The station with id `OPERATOR-CODE`. */
    suspend fun station(stationId: String): Either<Failure, Station>

    /** The station's departures on [day], one entry per line that runs then. */
    suspend fun timetable(stationId: String, day: ServiceDayName): Either<Failure, List<LineTimetable>>

    /** The stations a rider can walk to from this one, nearest first as the API orders them. */
    suspend fun transfers(stationId: String): Either<Failure, List<Transfer>>

    /** How often each line passes the station on [day], in the API's order. Not a schedule. */
    suspend fun frequencies(stationId: String, day: ServiceDayName): Either<Failure, List<Frequency>>

    /**
     * The station as already fetched this session, without asking. A screen opening onto data
     * another one just loaded starts from it, rather than from a skeleton.
     */
    fun cachedStation(stationId: String): Station? = null

    /** [timetable] as already fetched this session, without asking. */
    fun cachedTimetable(stationId: String, day: ServiceDayName): List<LineTimetable>? = null

    /** [transfers] as already fetched this session, without asking. */
    fun cachedTransfers(stationId: String): List<Transfer>? = null

    /** [frequencies] as already fetched this session, without asking. */
    fun cachedFrequencies(stationId: String, day: ServiceDayName): List<Frequency>? = null
}

interface LineRepository {

    /**
     * The line dictionary, keyed `OPERATOR:CODE`. Responses refer to lines by key, and this is
     * where the keys resolve to a name and a colour. Fetched once and held in memory.
     */
    suspend fun lines(): Either<Failure, Map<String, LineInfo>>

    /** The dictionary if it has been fetched, without asking. */
    fun cachedLines(): Map<String, LineInfo>? = null
}
