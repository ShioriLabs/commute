package id.shiorilabs.commute.feature.trip.runtime

import id.shiorilabs.commute.core.model.models.TrackShapes
import id.shiorilabs.commute.core.network.service.CommuteService
import id.shiorilabs.commute.core.query.QueryClient
import id.shiorilabs.commute.core.query.QueryPolicy
import id.shiorilabs.commute.core.query.QuerySpec
import id.shiorilabs.commute.core.query.queryKey
import kotlinx.coroutines.flow.first
import javax.inject.Inject
import javax.inject.Singleton

/** The real shape of every hop, keyed `{from}>{to}` by station id, for a trip about to start. */
fun interface TrackShapeSource {

    /** The shapes, or `null` when there are none to be had. */
    suspend fun shapes(): Map<String, String>?
}

/**
 * Serves `/_internal/track-shapes` through the [QueryClient], so a trip started offline still has
 * the copy last fetched. Compiled into the API, so held a day like the lines; revalidated with its
 * ETag on every launch by [TrackShapesWarmup][id.shiorilabs.commute.feature.trip.startup.TrackShapesWarmup].
 */
@Singleton
class QueryTrackShapeSource @Inject constructor(
    private val service: CommuteService,
    private val queries: QueryClient,
) : TrackShapeSource {

    private val shapesQuery = QuerySpec(
        key = queryKey("track-shapes"),
        serializer = TrackShapes.serializer(),
        policy = QueryPolicy.Static,
        isUsable = { it.shapes.isNotEmpty() },
    ) { etag -> service.getTrackShapes(etag) }

    /** The copy held, however old, without waiting on the network; else a fetch. */
    override suspend fun shapes(): Map<String, String>? =
        (queries.observe(shapesQuery).first().data ?: queries.fetch(shapesQuery).getOrNull())?.shapes

    /** Fetches a fresh copy when the one held is due one: a 304 when it hasn't changed. */
    suspend fun refresh() {
        queries.fetch(shapesQuery)
    }
}
