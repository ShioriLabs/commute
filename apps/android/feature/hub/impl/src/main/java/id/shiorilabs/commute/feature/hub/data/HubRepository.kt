package id.shiorilabs.commute.feature.hub.data

import id.shiorilabs.commute.core.query.Resource
import id.shiorilabs.commute.feature.hub.domain.Hub

/**
 * Hubs by slug. Cached, on disk too, so a hub opened before still opens offline, labelled with its
 * age; only with nothing held is the failure returned.
 */
interface HubRepository {

    fun hub(slug: String): Resource<Hub>
}
