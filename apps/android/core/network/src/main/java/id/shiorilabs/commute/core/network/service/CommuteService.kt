package id.shiorilabs.commute.core.network.service

import id.shiorilabs.commute.core.model.models.GroupedTimetable
import id.shiorilabs.commute.core.model.models.HeadwayRow
import id.shiorilabs.commute.core.model.models.OperatorWithLines
import id.shiorilabs.commute.core.model.models.SearchableIndex
import id.shiorilabs.commute.core.model.models.Station
import id.shiorilabs.commute.core.model.models.Transfer
import id.shiorilabs.commute.core.model.models.TripResult
import id.shiorilabs.commute.core.type.Fetched

/**
 * The one backend: the Commute API. Every method throws
 * [id.shiorilabs.commute.core.type.ApiException] on a non-2xx response and returns the envelope's
 * `data` as a [Fetched].
 *
 * Every method takes an optional `ifNoneMatch`: the ETag of the copy the caller already holds. When
 * the server's copy is still that one it answers a bodyless 304, [Fetched.NotModified], instead of
 * sending the body again. Without one the answer is always a [Fetched.Body].
 */
interface CommuteService {

    /**
     * The whole search index in one response: stations, hubs and lines, with the lines they
     * reference sent once in a dictionary.
     */
    suspend fun getSearchables(ifNoneMatch: String? = null): Fetched<SearchableIndex>

    /** One station. [operator] and [stationCode] are the two halves of its id (`KCI`, `MRI`). */
    suspend fun getStation(operator: String, stationCode: String, ifNoneMatch: String? = null): Fetched<Station>

    /**
     * The station's departures on [day] (`WD`, `SAT` or `SUN`), grouped by line, then direction,
     * then terminus. Always the full form: the compact one's tuples have no typed model.
     */
    suspend fun getGroupedTimetable(
        operator: String,
        stationCode: String,
        day: String,
        ifNoneMatch: String? = null,
    ): Fetched<List<GroupedTimetable>>

    /**
     * The station's transfers: nearby stations to walk to, on this API's network (`INTERNAL`, with
     * a station reference) or off it (`EXTERNAL`, a name only), each with its walking distance.
     */
    suspend fun getTransfers(
        operator: String,
        stationCode: String,
        ifNoneMatch: String? = null,
    ): Fetched<List<Transfer>>

    /**
     * How often each line passes the station on [day] (`WD`, `SAT` or `SUN`): an average gap, not a
     * schedule, so it can't say when the next one comes. TransJakarta's stand-in for a timetable.
     */
    suspend fun getHeadway(
        operator: String,
        stationCode: String,
        day: String,
        ifNoneMatch: String? = null,
    ): Fetched<List<HeadwayRow>>

    /** Every operator with its lines: the dictionary line keys resolve against. */
    suspend fun getOperators(ifNoneMatch: String? = null): Fetched<List<OperatorWithLines>>

    /**
     * Several priced route options from station [fromId] to [toId] (full ids, `KCI-SUD`), each with
     * its legs, fare segments and labels, and clock times on the legs whose schedule is known.
     *
     * Every criterion is optional and is sent only when non-null: an absent one is the server's
     * default, which keeps a default search on the same cache entry the web warms.
     * [paymentMethod] is `STORED_VALUE` or `QRIS_TAP`; [at] an ISO-8601 instant; [modes] `rail` to
     * leave TransJakarta out; [walking] `BRISK`, `SLOW` or `SLOWEST`.
     */
    suspend fun getTrips(
        fromId: String,
        toId: String,
        paymentMethod: String? = null,
        at: String? = null,
        modes: String? = null,
        walking: String? = null,
        ifNoneMatch: String? = null,
    ): Fetched<TripResult>
}
