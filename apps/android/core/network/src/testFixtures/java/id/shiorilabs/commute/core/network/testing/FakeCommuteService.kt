package id.shiorilabs.commute.core.network.testing

import id.shiorilabs.commute.core.model.models.GroupedTimetable
import id.shiorilabs.commute.core.model.models.OperatorWithLines
import id.shiorilabs.commute.core.model.models.SearchableIndex
import id.shiorilabs.commute.core.model.models.Station
import id.shiorilabs.commute.core.model.models.Transfer
import id.shiorilabs.commute.core.model.models.TripResult
import id.shiorilabs.commute.core.network.response.Response
import id.shiorilabs.commute.core.network.service.CommuteService

/**
 * In-memory [CommuteService] for repository tests. Each endpoint answers from a settable lambda, so
 * a test states only the response (or the throw) it cares about; an endpoint left unset fails
 * loudly rather than returning something plausible.
 */
class FakeCommuteService : CommuteService {

    var searchables: suspend () -> SearchableIndex = { error("getSearchables was not stubbed") }

    /** How many times [getSearchables] was called — for asserting that a repository caches. */
    var searchablesCalls: Int = 0
        private set

    override suspend fun getSearchables(): Response<SearchableIndex> {
        searchablesCalls++
        return Response(status = 200, data = searchables())
    }

    var station: suspend (operator: String, stationCode: String) -> Station =
        { _, _ -> error("getStation was not stubbed") }

    var groupedTimetable: suspend (operator: String, stationCode: String, day: String) -> List<GroupedTimetable> =
        { _, _, _ -> error("getGroupedTimetable was not stubbed") }

    var transfers: suspend (operator: String, stationCode: String) -> List<Transfer> =
        { _, _ -> error("getTransfers was not stubbed") }

    /** How many times [getTransfers] was called — for asserting that a repository caches. */
    var transfersCalls: Int = 0
        private set

    var operators: suspend () -> List<OperatorWithLines> = { error("getOperators was not stubbed") }

    /** How many times [getOperators] was called — for asserting that the dictionary is cached. */
    var operatorsCalls: Int = 0
        private set

    override suspend fun getStation(operator: String, stationCode: String): Response<Station> =
        Response(status = 200, data = station(operator, stationCode))

    override suspend fun getGroupedTimetable(
        operator: String,
        stationCode: String,
        day: String,
    ): Response<List<GroupedTimetable>> = Response(status = 200, data = groupedTimetable(operator, stationCode, day))

    override suspend fun getTransfers(operator: String, stationCode: String): Response<List<Transfer>> {
        transfersCalls++
        return Response(status = 200, data = transfers(operator, stationCode))
    }

    override suspend fun getOperators(): Response<List<OperatorWithLines>> {
        operatorsCalls++
        return Response(status = 200, data = operators())
    }

    var trips: suspend (fromId: String, toId: String, criteria: TripCriteria) -> TripResult =
        { _, _, _ -> error("getTrips was not stubbed") }

    /** How many times [getTrips] was called — for asserting that a repository caches. */
    var tripsCalls: Int = 0
        private set

    override suspend fun getTrips(
        fromId: String,
        toId: String,
        paymentMethod: String?,
        at: String?,
        modes: String?,
        walking: String?,
    ): Response<TripResult> {
        tripsCalls++
        return Response(status = 200, data = trips(fromId, toId, TripCriteria(paymentMethod, at, modes, walking)))
    }

    /** The optional query params of one [getTrips] call, as sent. */
    data class TripCriteria(
        val paymentMethod: String?,
        val at: String?,
        val modes: String?,
        val walking: String?,
    )
}
