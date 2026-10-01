package id.shiorilabs.commute.feature.station.data

import arrow.core.Either
import id.shiorilabs.commute.core.time.ServiceDayName
import id.shiorilabs.commute.core.type.Failure
import id.shiorilabs.commute.feature.station.domain.LineInfo
import id.shiorilabs.commute.feature.station.domain.LineTimetable
import id.shiorilabs.commute.feature.station.domain.Station

interface StationRepository {

    /** The station with id `OPERATOR-CODE`. */
    suspend fun station(stationId: String): Either<Failure, Station>

    /** The station's departures on [day], one entry per line that runs then. */
    suspend fun timetable(stationId: String, day: ServiceDayName): Either<Failure, List<LineTimetable>>
}

interface LineRepository {

    /**
     * The line dictionary, keyed `OPERATOR:CODE`. Responses refer to lines by key, and this is
     * where the keys resolve to a name and a colour. Fetched once and held in memory.
     */
    suspend fun lines(): Either<Failure, Map<String, LineInfo>>
}
