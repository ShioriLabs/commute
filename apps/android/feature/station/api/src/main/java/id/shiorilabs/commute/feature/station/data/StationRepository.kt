package id.shiorilabs.commute.feature.station.data

import arrow.core.Either
import id.shiorilabs.commute.core.query.Refetched
import id.shiorilabs.commute.core.query.Resource
import id.shiorilabs.commute.core.query.resourceOnce
import id.shiorilabs.commute.core.time.ServiceDayName
import id.shiorilabs.commute.core.type.Failure
import id.shiorilabs.commute.feature.station.domain.CrowdForecast
import id.shiorilabs.commute.feature.station.domain.Frequency
import id.shiorilabs.commute.feature.station.domain.LineInfo
import id.shiorilabs.commute.feature.station.domain.LineTimetable
import id.shiorilabs.commute.feature.station.domain.Station
import id.shiorilabs.commute.feature.station.domain.StationExit
import id.shiorilabs.commute.feature.station.domain.Transfer
import kotlinx.coroutines.flow.StateFlow

/**
 * Stations and their boards, each a [Resource]: cached, on disk too, so a fetch answers at once
 * while what is held is fresh, and falls back to an older copy when the network fails.
 */
interface StationRepository {

    /** The station with id `OPERATOR-CODE`. */
    fun station(stationId: String): Resource<Station>

    /** The station's departures on [day], one entry per line that runs then. */
    fun timetable(stationId: String, day: ServiceDayName): Resource<List<LineTimetable>>

    /** The stations a rider can walk to from this one, nearest first as the API orders them. */
    fun transfers(stationId: String): Resource<List<Transfer>>

    /** The station's exits and the signs at them. Most stations have none recorded yet. */
    fun exits(stationId: String): Resource<List<StationExit>> = resourceOnce { Either.Right(emptyList()) }

    /**
     * How often each line passes the station on [day] at [hour] (0-23, Jakarta), in the API's order.
     * Not a schedule. A corridor's figure changes through the day, so each hour is its own answer.
     */
    fun frequencies(stationId: String, day: ServiceDayName, hour: Int): Resource<List<Frequency>>

    /** How crowded the station usually is on [day], hour by hour. A forecast, and rail only. */
    fun crowding(stationId: String, day: ServiceDayName): Resource<CrowdForecast> =
        resourceOnce { Either.Right(CrowdForecast.NONE) }

    /**
     * Asks again for every part of [stationId] being observed (the station, its boards, a halte's
     * frequencies), whatever their age, and once they are in (at once offline) says what they found.
     * A pull to refresh.
     */
    suspend fun refresh(stationId: String): Refetched = Refetched()
}

interface LineRepository {

    /**
     * The line dictionary, keyed `OPERATOR:CODE`. Responses refer to lines by key, and this is
     * where the keys resolve to a name and a colour. Cached like the rest, for a day at a time.
     */
    suspend fun lines(): Either<Failure, Map<String, LineInfo>>

    /**
     * The dictionary as the app holds it, one for every screen: empty until it has loaded, then
     * whatever was last fetched. It loads by itself (at launch, on reconnecting, and whenever
     * someone starts watching it still empty), so a screen only watches; its value is there for
     * whoever just needs it now. A retry asks with [lines], whose answer lands here too.
     */
    val dictionary: StateFlow<Map<String, LineInfo>>
}
