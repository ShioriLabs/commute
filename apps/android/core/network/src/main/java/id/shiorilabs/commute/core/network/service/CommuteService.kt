package id.shiorilabs.commute.core.network.service

import id.shiorilabs.commute.core.model.models.GroupedTimetable
import id.shiorilabs.commute.core.model.models.OperatorWithLines
import id.shiorilabs.commute.core.model.models.SearchableIndex
import id.shiorilabs.commute.core.model.models.Station
import id.shiorilabs.commute.core.model.models.Transfer
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
}
