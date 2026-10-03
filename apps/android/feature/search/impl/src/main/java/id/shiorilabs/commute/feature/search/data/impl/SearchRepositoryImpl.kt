package id.shiorilabs.commute.feature.search.data.impl

import arrow.core.Either
import arrow.core.right
import id.shiorilabs.commute.core.ext.apiCallToFailure
import id.shiorilabs.commute.core.network.service.CommuteService
import id.shiorilabs.commute.core.type.Failure
import id.shiorilabs.commute.core.type.requireBody
import id.shiorilabs.commute.feature.search.data.SearchRepository
import id.shiorilabs.commute.feature.search.domain.Searchable
import id.shiorilabs.commute.feature.search.domain.toSearchables
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Holds the index in memory once fetched. Not persisted: the disk-backed cache that would let search
 * work offline is `:core:query`'s job, and it doesn't exist yet. A failure is not cached, so the
 * next call tries again.
 */
@Singleton
class SearchRepositoryImpl @Inject constructor(
    private val service: CommuteService,
) : SearchRepository {

    private val mutex = Mutex()
    private var cached: List<Searchable>? = null

    // Under the lock so two screens opening at once share one request rather than racing two.
    override suspend fun searchables(): Either<Failure, List<Searchable>> = mutex.withLock {
        cached?.right() ?: apiCallToFailure {
            service.getSearchables().requireBody().toSearchables()
        }.onRight { cached = it }
    }
}
