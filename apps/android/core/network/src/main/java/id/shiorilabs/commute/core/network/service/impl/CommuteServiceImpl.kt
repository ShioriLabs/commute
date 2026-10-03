package id.shiorilabs.commute.core.network.service.impl

import id.shiorilabs.commute.core.model.models.GroupedTimetable
import id.shiorilabs.commute.core.model.models.HeadwayRow
import id.shiorilabs.commute.core.model.models.OperatorWithLines
import id.shiorilabs.commute.core.model.models.SearchableIndex
import id.shiorilabs.commute.core.model.models.Station
import id.shiorilabs.commute.core.model.models.Transfer
import id.shiorilabs.commute.core.model.models.TripResult
import id.shiorilabs.commute.core.network.ext.decodeFetched
import id.shiorilabs.commute.core.network.service.CommuteService
import id.shiorilabs.commute.core.type.Fetched
import io.ktor.client.HttpClient
import io.ktor.client.request.HttpRequestBuilder
import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.request.parameter
import io.ktor.http.HttpHeaders
import io.ktor.http.encodeURLPathPart
import javax.inject.Inject

class CommuteServiceImpl @Inject constructor(
    private val client: HttpClient,
) : CommuteService {

    override suspend fun getSearchables(ifNoneMatch: String?): Fetched<SearchableIndex> =
        client.get("_internal/searchables") { validator(ifNoneMatch) }.decodeFetched()

    override suspend fun getStation(operator: String, stationCode: String, ifNoneMatch: String?): Fetched<Station> =
        client.get(stationPath(operator, stationCode)) { validator(ifNoneMatch) }.decodeFetched()

    override suspend fun getGroupedTimetable(
        operator: String,
        stationCode: String,
        day: String,
        ifNoneMatch: String?,
    ): Fetched<List<GroupedTimetable>> =
        client.get("${stationPath(operator, stationCode)}/timetable/grouped") {
            parameter("day", day)
            validator(ifNoneMatch)
        }.decodeFetched()

    override suspend fun getTransfers(
        operator: String,
        stationCode: String,
        ifNoneMatch: String?,
    ): Fetched<List<Transfer>> =
        client.get("${stationPath(operator, stationCode)}/transfers") { validator(ifNoneMatch) }.decodeFetched()

    override suspend fun getHeadway(
        operator: String,
        stationCode: String,
        day: String,
        ifNoneMatch: String?,
    ): Fetched<List<HeadwayRow>> =
        client.get("${stationPath(operator, stationCode)}/headway") {
            parameter("day", day)
            validator(ifNoneMatch)
        }.decodeFetched()

    override suspend fun getOperators(ifNoneMatch: String?): Fetched<List<OperatorWithLines>> =
        client.get("operators") { validator(ifNoneMatch) }.decodeFetched()

    override suspend fun getTrips(
        fromId: String,
        toId: String,
        paymentMethod: String?,
        at: String?,
        modes: String?,
        walking: String?,
        ifNoneMatch: String?,
    ): Fetched<TripResult> =
        client.get("_internal/trips/${fromId.encodeURLPathPart()}/${toId.encodeURLPathPart()}") {
            // Ktor drops a null parameter, so an unset criterion never reaches the query string.
            parameter("paymentMethod", paymentMethod)
            parameter("at", at)
            parameter("modes", modes)
            parameter("walking", walking)
            validator(ifNoneMatch)
        }.decodeFetched()

    private fun stationPath(operator: String, stationCode: String): String =
        "stations/${operator.encodeURLPathPart()}/${stationCode.encodeURLPathPart()}"

    /** Asks for a 304 instead of the body when the server's copy is still [etag]. */
    private fun HttpRequestBuilder.validator(etag: String?) {
        if (etag != null) {
            header(HttpHeaders.IfNoneMatch, etag)
        }
    }
}
