package id.shiorilabs.commute.feature.hub.data.impl

import arrow.core.Either
import id.shiorilabs.commute.core.network.service.CommuteService
import id.shiorilabs.commute.core.query.Query
import id.shiorilabs.commute.core.query.QueryClient
import id.shiorilabs.commute.core.query.QueryPolicy
import id.shiorilabs.commute.core.query.QuerySpec
import id.shiorilabs.commute.core.query.queryKey
import id.shiorilabs.commute.core.type.Failure
import id.shiorilabs.commute.feature.hub.data.HubRepository
import id.shiorilabs.commute.feature.hub.domain.Hub
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
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

    override suspend fun hub(slug: String): Either<Failure, Hub> =
        queries.fetch(hubQuery(slug)).map { it.toHub() }

    override fun observeHub(slug: String): Flow<Query<Hub>> =
        queries.observe(hubQuery(slug)).map { query -> query.map { it.toHub() } }

    override fun cachedHub(slug: String): Hub? = queries.peek(hubQuery(slug))?.data?.toHub()

    private companion object {

        const val HUB = "hub"
    }
}
