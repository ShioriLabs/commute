package id.shiorilabs.commute.core.network.testing

import id.shiorilabs.commute.core.model.models.GroupedTimetable
import id.shiorilabs.commute.core.model.models.HeadwayRow
import id.shiorilabs.commute.core.model.models.Hub
import id.shiorilabs.commute.core.model.models.LineDetail
import id.shiorilabs.commute.core.model.models.OperatorWithLines
import id.shiorilabs.commute.core.model.models.SearchableIndex
import id.shiorilabs.commute.core.model.models.Station
import id.shiorilabs.commute.core.model.models.TrackShapes
import id.shiorilabs.commute.core.model.models.Transfer
import id.shiorilabs.commute.core.model.models.TripResult
import id.shiorilabs.commute.core.network.service.CommuteService
import id.shiorilabs.commute.core.type.Fetched

/**
 * In-memory [CommuteService] for repository tests. Each endpoint answers from a settable lambda, so
 * a test states only the response (or the throw) it cares about; an endpoint left unset fails
 * loudly rather than returning something plausible.
 *
 * Every body goes out with [etag]. A call that sends it back as `If-None-Match` is answered
 * [Fetched.NotModified] without running the endpoint's lambda, as the server's 304 would be.
 */
class FakeCommuteService : CommuteService {

    /** The ETag every answer carries; null sends none, so nothing is ever answered with a 304. */
    var etag: String? = null

    /** The `If-None-Match` the most recent call sent. */
    var lastIfNoneMatch: String? = null
        private set

    var searchables: suspend () -> SearchableIndex = { error("getSearchables was not stubbed") }

    /** How many times [getSearchables] was called — for asserting that a repository caches. */
    var searchablesCalls: Int = 0
        private set

    override suspend fun getSearchables(ifNoneMatch: String?): Fetched<SearchableIndex> {
        searchablesCalls++
        return answer(ifNoneMatch) { searchables() }
    }

    var trackShapes: suspend () -> TrackShapes = { error("getTrackShapes was not stubbed") }

    override suspend fun getTrackShapes(ifNoneMatch: String?): Fetched<TrackShapes> =
        answer(ifNoneMatch) { trackShapes() }

    var station: suspend (operator: String, stationCode: String) -> Station =
        { _, _ -> error("getStation was not stubbed") }

    /** How many times [getStation] was called — for asserting that a repository caches. */
    var stationCalls: Int = 0
        private set

    var groupedTimetable: suspend (operator: String, stationCode: String, day: String) -> List<GroupedTimetable> =
        { _, _, _ -> error("getGroupedTimetable was not stubbed") }

    /** How many times [getGroupedTimetable] was called — for asserting that a repository caches. */
    var groupedTimetableCalls: Int = 0
        private set

    var transfers: suspend (operator: String, stationCode: String) -> List<Transfer> =
        { _, _ -> error("getTransfers was not stubbed") }

    /** How many times [getTransfers] was called — for asserting that a repository caches. */
    var transfersCalls: Int = 0
        private set

    var headway: suspend (operator: String, stationCode: String, day: String) -> List<HeadwayRow> =
        { _, _, _ -> error("getHeadway was not stubbed") }

    /** How many times [getHeadway] was called — for asserting that a repository caches, or skips it. */
    var headwayCalls: Int = 0
        private set

    var operators: suspend () -> List<OperatorWithLines> = { error("getOperators was not stubbed") }

    /** How many times [getOperators] was called — for asserting that the dictionary is cached. */
    var operatorsCalls: Int = 0
        private set

    var stations: suspend () -> List<Station> = { error("getStations was not stubbed") }

    /** How many times [getStations] was called — for asserting that the directory is cached. */
    var stationsCalls: Int = 0
        private set

    override suspend fun getStations(ifNoneMatch: String?): Fetched<List<Station>> {
        stationsCalls++
        return answer(ifNoneMatch) { stations() }
    }

    override suspend fun getStation(operator: String, stationCode: String, ifNoneMatch: String?): Fetched<Station> {
        stationCalls++
        return answer(ifNoneMatch) { station(operator, stationCode) }
    }

    override suspend fun getGroupedTimetable(
        operator: String,
        stationCode: String,
        day: String,
        ifNoneMatch: String?,
    ): Fetched<List<GroupedTimetable>> {
        groupedTimetableCalls++
        return answer(ifNoneMatch) { groupedTimetable(operator, stationCode, day) }
    }

    override suspend fun getTransfers(
        operator: String,
        stationCode: String,
        ifNoneMatch: String?,
    ): Fetched<List<Transfer>> {
        transfersCalls++
        return answer(ifNoneMatch) { transfers(operator, stationCode) }
    }

    override suspend fun getHeadway(
        operator: String,
        stationCode: String,
        day: String,
        ifNoneMatch: String?,
    ): Fetched<List<HeadwayRow>> {
        headwayCalls++
        return answer(ifNoneMatch) { headway(operator, stationCode, day) }
    }

    override suspend fun getOperators(ifNoneMatch: String?): Fetched<List<OperatorWithLines>> {
        operatorsCalls++
        return answer(ifNoneMatch) { operators() }
    }

    var hub: suspend (slug: String) -> Hub = { error("getHub was not stubbed") }

    /** How many times [getHub] was called — for asserting that a repository caches. */
    var hubCalls: Int = 0
        private set

    override suspend fun getHub(slug: String, ifNoneMatch: String?): Fetched<Hub> {
        hubCalls++
        return answer(ifNoneMatch) { hub(slug) }
    }

    var line: suspend (operator: String, lineCode: String) -> LineDetail =
        { _, _ -> error("getLine was not stubbed") }

    /** How many times [getLine] was called — for asserting that a repository caches. */
    var lineCalls: Int = 0
        private set

    override suspend fun getLine(operator: String, lineCode: String, ifNoneMatch: String?): Fetched<LineDetail> {
        lineCalls++
        return answer(ifNoneMatch) { line(operator, lineCode) }
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
        ifNoneMatch: String?,
    ): Fetched<TripResult> {
        tripsCalls++
        return answer(ifNoneMatch) { trips(fromId, toId, TripCriteria(paymentMethod, at, modes, walking)) }
    }

    private suspend fun <T> answer(ifNoneMatch: String?, body: suspend () -> T): Fetched<T> {
        lastIfNoneMatch = ifNoneMatch
        val current = etag
        return if (current != null && ifNoneMatch == current) {
            Fetched.NotModified(current)
        } else {
            Fetched.Body(body(), current)
        }
    }

    /** The optional query params of one [getTrips] call, as sent. */
    data class TripCriteria(
        val paymentMethod: String?,
        val at: String?,
        val modes: String?,
        val walking: String?,
    )
}
