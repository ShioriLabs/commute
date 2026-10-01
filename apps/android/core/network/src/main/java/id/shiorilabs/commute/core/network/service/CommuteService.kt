package id.shiorilabs.commute.core.network.service

import id.shiorilabs.commute.core.model.models.SearchableIndex
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
}
