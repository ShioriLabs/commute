package id.shiorilabs.commute.wear

import android.content.Context
import android.net.Uri
import com.google.android.gms.wearable.DataClient
import com.google.android.gms.wearable.DataEvent
import com.google.android.gms.wearable.DataEventBuffer
import com.google.android.gms.wearable.PutDataRequest
import com.google.android.gms.wearable.Wearable
import id.shiorilabs.commute.core.wearable.WearPaths
import id.shiorilabs.commute.core.wearable.WearTrip
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.tasks.await

/** The phone's running trip, as the Data Layer has it: `null` when there is none. */
class WearTripRepository(context: Context) {

    private val client = Wearable.getDataClient(context.applicationContext)

    val trip: Flow<WearTrip?> = callbackFlow {
        val listener = DataClient.OnDataChangedListener { events -> events.latestTrip()?.let { trySend(it.trip) } }
        // Not awaited: the stored trip is read alongside registering, not after it, which costs the
        // first frame a few hundred milliseconds on a watch.
        client.addListener(listener)
        send(current())
        awaitClose { client.removeListener(listener) }
    }

    /** The trip as last synced, from the watch's own copy: there even with the phone out of reach. */
    private suspend fun current(): WearTrip? = runCatching {
        val items = client.getDataItems(TRIP_URI).await()
        try {
            items.firstOrNull()?.data?.let(WearTrip::decode)
        } finally {
            items.release()
        }
    }.getOrNull()

    private companion object {

        val TRIP_URI: Uri = Uri.Builder().scheme(PutDataRequest.WEAR_URI_SCHEME).path(WearPaths.TRIP).build()
    }
}

/** The last change to the trip among [this], if any; [TripChange.trip] is `null` once it's gone. */
internal fun DataEventBuffer.latestTrip(): TripChange? =
    lastOrNull { it.dataItem.uri.path == WearPaths.TRIP }?.let { event ->
        TripChange(if (event.type == DataEvent.TYPE_DELETED) null else event.dataItem.data?.let(WearTrip::decode))
    }

internal class TripChange(val trip: WearTrip?)
