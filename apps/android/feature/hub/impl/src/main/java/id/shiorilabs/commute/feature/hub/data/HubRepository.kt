package id.shiorilabs.commute.feature.hub.data

import arrow.core.Either
import id.shiorilabs.commute.core.query.Query
import id.shiorilabs.commute.core.query.queryOnce
import id.shiorilabs.commute.core.type.Failure
import id.shiorilabs.commute.feature.hub.domain.Hub
import kotlinx.coroutines.flow.Flow

/**
 * Hubs by slug. Cached, on disk too, so a hub opened before still opens offline, labelled with its
 * age; only with nothing held is the failure returned.
 */
interface HubRepository {

    suspend fun hub(slug: String): Either<Failure, Hub>

    /**
     * [hub], as it changes: what is held first, however old, then a fresh answer if it was due one.
     * Doesn't complete. The default serves a fake with no cache of its own from [hub].
     */
    fun observeHub(slug: String): Flow<Query<Hub>> = queryOnce(cachedHub(slug)) { hub(slug) }

    /** The hub as already loaded this session, without asking or reading the disk. */
    fun cachedHub(slug: String): Hub? = null
}
