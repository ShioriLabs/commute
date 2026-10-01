package id.shiorilabs.commute.core.network.service.impl

import id.shiorilabs.commute.core.model.models.SearchableIndex
import id.shiorilabs.commute.core.network.ext.decodeOrThrow
import id.shiorilabs.commute.core.network.response.Response
import id.shiorilabs.commute.core.network.service.CommuteService
import io.ktor.client.HttpClient
import io.ktor.client.request.get
import javax.inject.Inject

class CommuteServiceImpl @Inject constructor(
    private val client: HttpClient,
) : CommuteService {

    override suspend fun getSearchables(): Response<SearchableIndex> =
        client.get("_internal/searchables").decodeOrThrow()
}
