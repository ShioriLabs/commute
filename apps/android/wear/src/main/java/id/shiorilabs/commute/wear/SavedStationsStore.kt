package id.shiorilabs.commute.wear

import android.content.Context
import android.net.Uri
import com.google.android.gms.wearable.DataClient
import com.google.android.gms.wearable.DataEventBuffer
import com.google.android.gms.wearable.PutDataRequest
import com.google.android.gms.wearable.Wearable
import id.shiorilabs.commute.core.wearable.WearPaths
import id.shiorilabs.commute.core.wearable.WearStation
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await

/** The saved stations' timetables, as the phone last sent them: there with the phone out of reach. */
class SavedStationsStore(context: Context) {

    private val client = Wearable.getDataClient(context.applicationContext)

    /** Every saved station the watch has a copy of; none when the Data Layer can't be read. */
    suspend fun all(): List<WearStation> = runCatching {
        val items = client.getDataItems(PREFIX_URI, DataClient.FILTER_PREFIX).await()
        try {
            items.mapNotNull { item -> item.data?.let(WearStation::decode) }
        } finally {
            items.release()
        }
    }.getOrDefault(emptyList())

    suspend fun station(stationId: String): WearStation? = all().firstOrNull { it.id == stationId }

    /** [all], and again each time the phone sends a change. */
    val stations: Flow<List<WearStation>> = callbackFlow {
        val listener = DataClient.OnDataChangedListener { events ->
            if (events.touchesSavedStations()) launch { send(all()) }
        }
        client.addListener(listener)
        send(all())
        awaitClose { client.removeListener(listener) }
    }

    private companion object {

        val PREFIX_URI: Uri = Uri.Builder().scheme(PutDataRequest.WEAR_URI_SCHEME).path(WearPaths.SAVED_STATION).build()
    }
}

/** Whether any of [this] is a saved station coming or going. */
internal fun DataEventBuffer.touchesSavedStations(): Boolean =
    any { it.dataItem.uri.path?.startsWith(WearPaths.SAVED_STATION) == true }
