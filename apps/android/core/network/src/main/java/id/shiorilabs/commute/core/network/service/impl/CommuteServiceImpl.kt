package id.shiorilabs.commute.core.network.service.impl

import id.shiorilabs.commute.core.model.models.GroupedTimetable
import id.shiorilabs.commute.core.model.models.OperatorWithLines
import id.shiorilabs.commute.core.model.models.SearchableIndex
import id.shiorilabs.commute.core.model.models.Station
import id.shiorilabs.commute.core.model.models.Transfer
import id.shiorilabs.commute.core.network.ext.decodeOrThrow
import id.shiorilabs.commute.core.network.response.Response
import id.shiorilabs.commute.core.network.service.CommuteService
import io.ktor.client.HttpClient
import io.ktor.client.request.get
import io.ktor.client.request.parameter
import io.ktor.http.encodeURLPathPart
import javax.inject.Inject

class CommuteServiceImpl @Inject constructor(
    private val client: HttpClient,
) : CommuteService {

    override suspend fun getSearchables(): Response<SearchableIndex> =
        client.get("_internal/searchables").decodeOrThrow()

    override suspend fun getStation(operator: String, stationCode: String): Response<Station> =
        client.get("stations/${operator.encodeURLPathPart()}/${stationCode.encodeURLPathPart()}").decodeOrThrow()

    override suspend fun getGroupedTimetable(
        operator: String,
        stationCode: String,
        day: String,
    ): Response<List<GroupedTimetable>> =
        client.get("stations/${operator.encodeURLPathPart()}/${stationCode.encodeURLPathPart()}/timetable/grouped") {
            parameter("day", day)
        }.decodeOrThrow()

    override suspend fun getTransfers(operator: String, stationCode: String): Response<List<Transfer>> =
        client.get("stations/${operator.encodeURLPathPart()}/${stationCode.encodeURLPathPart()}/transfers").decodeOrThrow()

    override suspend fun getOperators(): Response<List<OperatorWithLines>> =
        client.get("operators").decodeOrThrow()
}
