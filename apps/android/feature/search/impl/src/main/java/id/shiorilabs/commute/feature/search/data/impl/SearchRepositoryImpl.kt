package id.shiorilabs.commute.feature.search.data.impl

import arrow.core.Either
import id.shiorilabs.commute.core.ext.onDataThread
import id.shiorilabs.commute.core.model.models.SearchableIndex
import id.shiorilabs.commute.core.network.service.CommuteService
import id.shiorilabs.commute.core.query.QueryClient
import id.shiorilabs.commute.core.query.QueryPolicy
import id.shiorilabs.commute.core.query.QuerySpec
import id.shiorilabs.commute.core.query.queryKey
import id.shiorilabs.commute.core.type.Failure
import id.shiorilabs.commute.feature.search.data.SearchRepository
import id.shiorilabs.commute.feature.search.domain.Searchable
import id.shiorilabs.commute.feature.search.domain.toSearchables
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Serves the index through the [QueryClient], so search works offline from the copy last fetched.
 * Two screens opening at once share one request. The index changes when an importer runs, so it is
 * held as long as the stations themselves.
 */
@Singleton
class SearchRepositoryImpl @Inject constructor(
    private val service: CommuteService,
    private val queries: QueryClient,
) : SearchRepository {

    private val indexQuery = QuerySpec(
        key = queryKey("searchables"),
        serializer = SearchableIndex.serializer(),
        policy = QueryPolicy.Topology,
    ) { etag -> service.getSearchables(etag) }

    override suspend fun searchables(): Either<Failure, List<Searchable>> =
        queries.fetch(indexQuery).let { index -> onDataThread { index.map { it.toSearchables() } } }
}
