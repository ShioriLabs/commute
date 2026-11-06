package id.shiorilabs.commute.feature.hub.data

import arrow.core.Either
import id.shiorilabs.commute.core.type.Failure

/** A hub as the map knows it: by its stable [id] (`HUB-DKA`), with the [slug] its page opens by. */
data class HubSummary(
    val id: String,
    /** The URL key, e.g. `dukuh-atas`; may change, unlike [id]. */
    val slug: String,
    val name: String,
    /** `OPERATOR:CODE`, busiest first: the first tints the map's ring. */
    val lineKeys: List<String>,
)

/**
 * Every hub, cached on disk too: what turns the map's `HUB-…` tap targets into the hubs they name.
 * Only with nothing held is the failure returned.
 */
interface HubDirectory {

    suspend fun hubs(): Either<Failure, List<HubSummary>>

    /** The hubs as already loaded this session, without asking or reading the disk. */
    fun cachedHubs(): List<HubSummary>? = null
}
