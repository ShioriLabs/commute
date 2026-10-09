package id.shiorilabs.commute.feature.trip.startup

import id.shiorilabs.commute.core.query.di.ApplicationScope
import id.shiorilabs.commute.core.startup.StartupWarmup
import id.shiorilabs.commute.feature.trip.runtime.QueryTrackShapeSource
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * Keeps the track shapes on the disk before a trip needs them: trip mode must run with no network
 * once started, so the copy has to be there already when the rider taps "Mulai perjalanan".
 * Refreshed in the background, as nothing on the first screen waits for it.
 */
class TrackShapesWarmup @Inject constructor(
    private val shapes: QueryTrackShapeSource,
    @param:ApplicationScope private val scope: CoroutineScope,
) : StartupWarmup {

    override suspend fun warm() {
        scope.launch { shapes.refresh() }
    }
}
