package id.shiorilabs.commute.feature.hub.data.impl

import id.shiorilabs.commute.core.network.service.CommuteService
import id.shiorilabs.commute.core.query.QueryClient
import id.shiorilabs.commute.core.query.QueryPolicy
import id.shiorilabs.commute.core.query.QuerySpec
import id.shiorilabs.commute.core.query.Resource
import id.shiorilabs.commute.core.query.queryKey
import id.shiorilabs.commute.core.query.resource
import id.shiorilabs.commute.feature.hub.data.HubRepository
import id.shiorilabs.commute.feature.hub.domain.Hub
import javax.inject.Inject
import javax.inject.Singleton
import id.shiorilabs.commute.core.model.models.Hub as HubDto

/**
 * Serves hubs through the [QueryClient] under `hub/{slug}`. A hub only changes with a data deploy,
 * so it is held for the API's topology lifetime, an hour, as the web's cache holds it.
 */
@Singleton
class HubRepositoryImpl @Inject constructor(
    private val service: CommuteService,
    private val queries: QueryClient,
) : HubRepository {

    private fun hubQuery(slug: String): QuerySpec<HubDto> =
        QuerySpec(queryKey(HUB, slug), HubDto.serializer(), QueryPolicy.Topology) { etag ->
            service.getHub(slug, etag)
        }

    override fun hub(slug: String): Resource<Hub> = queries.resource(hubQuery(slug)) { it.toHub() }

    private companion object {

        const val HUB = "hub"
    }
}
