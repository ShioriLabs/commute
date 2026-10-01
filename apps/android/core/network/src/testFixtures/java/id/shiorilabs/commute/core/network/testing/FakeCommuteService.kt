package id.shiorilabs.commute.core.network.testing

import id.shiorilabs.commute.core.model.models.SearchableIndex
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
}
