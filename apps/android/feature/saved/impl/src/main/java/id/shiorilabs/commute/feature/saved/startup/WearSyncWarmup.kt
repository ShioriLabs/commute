package id.shiorilabs.commute.feature.saved.startup

import id.shiorilabs.commute.core.startup.StartupWarmup
import id.shiorilabs.commute.feature.saved.wear.SavedStationsWearSync
import javax.inject.Inject

/** Starts handing the saved stations to the watch, for as long as the process lives. */
class WearSyncWarmup @Inject constructor(
    private val sync: SavedStationsWearSync,
) : StartupWarmup {

    override suspend fun warm() = sync.start()
}
