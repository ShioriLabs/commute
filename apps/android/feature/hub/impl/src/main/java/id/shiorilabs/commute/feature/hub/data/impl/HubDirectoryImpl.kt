package id.shiorilabs.commute.feature.hub.data.impl

import arrow.core.Either
import id.shiorilabs.commute.core.network.service.CommuteService
import id.shiorilabs.commute.core.query.QueryClient
import id.shiorilabs.commute.core.query.QueryPolicy
import id.shiorilabs.commute.core.query.QuerySpec
import id.shiorilabs.commute.core.query.queryKey
import id.shiorilabs.commute.core.type.Failure
import id.shiorilabs.commute.feature.hub.data.HubDirectory
import id.shiorilabs.commute.feature.hub.data.HubSummary
import kotlinx.serialization.builtins.ListSerializer
import javax.inject.Inject
import javax.inject.Singleton
import id.shiorilabs.commute.core.model.models.Hub as HubDto

/**
 * Every hub through the [QueryClient] under `hubs`, held for the API's topology lifetime as one
 * hub is ([HubRepositoryImpl]): a hub only changes with a data deploy.
 */
@Singleton
class HubDirectoryImpl @Inject constructor(
    private val service: CommuteService,
    private val queries: QueryClient,
) : HubDirectory {

    private val hubsQuery = QuerySpec(queryKey(HUBS), ListSerializer(HubDto.serializer()), QueryPolicy.Topology) { etag ->
        service.getHubs(etag)
    }

    override suspend fun hubs(): Either<Failure, List<HubSummary>> = queries.fetch(hubsQuery).map { hubs -> hubs.map { it.toSummary() } }

    override fun cachedHubs(): List<HubSummary>? = queries.peek(hubsQuery)?.data?.map { it.toSummary() }

    private fun HubDto.toSummary() = HubSummary(id = id, slug = slug, name = name, lineKeys = lines)

    private companion object {

        const val HUBS = "hubs"
    }
}
