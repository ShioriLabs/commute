package id.shiorilabs.commute.feature.saved.wear

import com.google.android.gms.wearable.MessageEvent
import com.google.android.gms.wearable.WearableListenerService
import dagger.hilt.android.AndroidEntryPoint
import id.shiorilabs.commute.core.wearable.WearPaths
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeoutOrNull
import javax.inject.Inject

/**
 * The watch asking for the saved stations: one it has no copy of yet as a complication is set up,
 * or every one when its copies have grown old.
 */
@AndroidEntryPoint
class SavedSyncService : WearableListenerService() {

    @Inject
    lateinit var sync: SavedStationsWearSync

    override fun onMessageReceived(event: MessageEvent) {
        if (event.path != WearPaths.SAVED_SYNC) return
        val stationId = event.data.decodeToString().ifEmpty { null }
        // Blocking this service's own worker thread keeps the process up until the boards are out;
        // they are usually on disk, and a slow network gives up rather than holding it.
        runBlocking { withTimeoutOrNull(SYNC_TIMEOUT_MS) { runCatching { sync.publish(stationId) } } }
    }

    private companion object {

        const val SYNC_TIMEOUT_MS = 30_000L
    }
}
