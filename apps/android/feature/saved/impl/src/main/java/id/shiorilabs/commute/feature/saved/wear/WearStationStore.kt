package id.shiorilabs.commute.feature.saved.wear

import android.content.Context
import android.net.Uri
import com.google.android.gms.wearable.CapabilityClient
import com.google.android.gms.wearable.DataClient
import com.google.android.gms.wearable.PutDataRequest
import com.google.android.gms.wearable.Wearable
import dagger.hilt.android.qualifiers.ApplicationContext
import id.shiorilabs.commute.core.wearable.WearPaths
import id.shiorilabs.commute.core.wearable.WearStation
import kotlinx.coroutines.tasks.await
import javax.inject.Inject

/** Where the saved stations wait for the watch: the Data Layer, one item each. */
interface WearStationStore {

    /** Whether a watch with the app is paired, in reach or not: without one there is no one to send to. */
    suspend fun hasWatch(): Boolean

    /** The stations as last sent. */
    suspend fun stored(): List<WearStation>

    suspend fun put(station: WearStation)

    suspend fun remove(stationId: String)
}

class DataLayerWearStationStore @Inject constructor(
    @param:ApplicationContext private val context: Context,
) : WearStationStore {

    private val data: DataClient by lazy { Wearable.getDataClient(context) }

    override suspend fun hasWatch(): Boolean = runCatching {
        Wearable.getCapabilityClient(context)
            .getCapability(WearPaths.WEAR_CAPABILITY, CapabilityClient.FILTER_ALL)
            .await()
            .nodes
            .isNotEmpty()
    }.getOrDefault(false)

    override suspend fun stored(): List<WearStation> {
        val items = data.getDataItems(uriOf(""), DataClient.FILTER_PREFIX).await()
        return try {
            items.mapNotNull { item -> item.data?.let(WearStation::decode) }
        } finally {
            items.release()
        }
    }

    override suspend fun put(station: WearStation) {
        // Not urgent: a timetable can wait for the Data Layer's next batch to the watch.
        val request = PutDataRequest.create(WearPaths.SAVED_STATION + station.id).setData(station.encode())
        data.putDataItem(request).await()
    }

    override suspend fun remove(stationId: String) {
        data.deleteDataItems(uriOf(stationId)).await()
    }

    private fun uriOf(stationId: String): Uri =
        Uri.Builder().scheme(PutDataRequest.WEAR_URI_SCHEME).path(WearPaths.SAVED_STATION + stationId).build()
}
