package id.shiorilabs.commute.core.network.testing

import id.shiorilabs.commute.core.model.models.GroupedTimetable
import id.shiorilabs.commute.core.model.models.OperatorWithLines
import id.shiorilabs.commute.core.model.models.SearchableIndex
import id.shiorilabs.commute.core.model.models.Station
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

    override suspend fun getOperators(): Response<List<OperatorWithLines>> {
        operatorsCalls++
        return Response(status = 200, data = operators())
    }
}
