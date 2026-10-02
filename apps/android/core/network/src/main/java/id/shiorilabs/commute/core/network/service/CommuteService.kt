package id.shiorilabs.commute.core.network.service

import id.shiorilabs.commute.core.model.models.GroupedTimetable
import id.shiorilabs.commute.core.model.models.OperatorWithLines
import id.shiorilabs.commute.core.model.models.SearchableIndex
import id.shiorilabs.commute.core.model.models.Station
import id.shiorilabs.commute.core.model.models.Transfer
import id.shiorilabs.commute.core.model.models.TripResult
import id.shiorilabs.commute.core.network.response.Response

/**
 * The one backend: the Commute API. Every method throws
 * [id.shiorilabs.commute.core.type.ApiException] on a non-2xx response and returns the response
 * envelope; the repository unwraps `.data`.
 */
interface CommuteService {

    /**
     * The whole search index in one response: stations, hubs and lines, with the lines they
     * reference sent once in a dictionary.
     */
    suspend fun getSearchables(): Response<SearchableIndex>

    /** One station. [operator] and [stationCode] are the two halves of its id (`KCI`, `MRI`). */
    suspend fun getStation(operator: String, stationCode: String): Response<Station>

    /**
     * The station's departures on [day] (`WD`, `SAT` or `SUN`), grouped by line, then direction,
     * then terminus. Always the full form: the compact one's tuples have no typed model.
     */
    suspend fun getGroupedTimetable(operator: String, stationCode: String, day: String): Response<List<GroupedTimetable>>

    /**
     * The station's transfers: nearby stations to walk to, on this API's network (`INTERNAL`, with
     * a station reference) or off it (`EXTERNAL`, a name only), each with its walking distance.
     */
    suspend fun getTransfers(operator: String, stationCode: String): Response<List<Transfer>>

    /** Every operator with its lines: the dictionary line keys resolve against. */
    suspend fun getOperators(): Response<List<OperatorWithLines>>

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
    ): Response<TripResult>
}
