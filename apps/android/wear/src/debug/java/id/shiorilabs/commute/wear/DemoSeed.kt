package id.shiorilabs.commute.wear

import android.content.Context
import android.net.Uri
import com.google.android.gms.wearable.DataClient
import com.google.android.gms.wearable.PutDataRequest
import com.google.android.gms.wearable.Wearable
import id.shiorilabs.commute.core.time.ServiceDayName
import id.shiorilabs.commute.core.wearable.WearDay
import id.shiorilabs.commute.core.wearable.WearDirection
import id.shiorilabs.commute.core.wearable.WearPaths
import id.shiorilabs.commute.core.wearable.WearStation
import id.shiorilabs.commute.core.wearable.WearTrip
import kotlinx.coroutines.tasks.await
import java.time.Instant

/**
 * Puts what the phone would send onto the watch's own Data Layer, for trying the complications on
 * an emulator with no phone paired: two saved stations, and [trip] as the running trip.
 */
internal suspend fun seedDemo(context: Context, trip: WearTrip, now: Instant) {
    val client = Wearable.getDataClient(context)
    listOf(tebet(now), manggarai(now)).forEach { station ->
        client.putDataItem(PutDataRequest.create(WearPaths.SAVED_STATION + station.id).setData(station.encode()).setUrgent()).await()
    }
    client.putDataItem(PutDataRequest.create(WearPaths.TRIP).setData(trip.encode()).setUrgent()).await()
    TripComplicationService.update(context)
    DeparturesComplicationService.updateAll(context)
}

/** Takes the seeded items back. */
internal suspend fun unseedDemo(context: Context) {
    val client = Wearable.getDataClient(context)
    listOf(WearPaths.SAVED_STATION, WearPaths.TRIP).forEach { path ->
        client.deleteDataItems(Uri.Builder().scheme(PutDataRequest.WEAR_URI_SCHEME).path(path).build(), DataClient.FILTER_PREFIX).await()
    }
    TripComplicationService.update(context)
    DeparturesComplicationService.updateAll(context)
}

/** Every [every] minutes through the day from 04.24, and a last one past midnight. */
private fun day(every: Int, offset: Int = 0) = WearDay(start = 264, minutes = (264 + offset until 1440 step every).toList() + 30)

private fun tebet(now: Instant) = WearStation(
    id = "KCI-TEB",
    name = "Tebet",
    builtAt = now.toEpochMilli(),
    directions = listOf(
        WearDirection("KCI:B|S", "KCI:B", "Lin Bogor", 0xFFEE3D43.toInt(), "Depok · Bogor", "1/2", ServiceDayName.entries.associateWith { day(7) }),
        WearDirection("KCI:B|N", "KCI:B", "Lin Bogor", 0xFFEE3D43.toInt(), "Manggarai · Jakarta Kota", "3/4", ServiceDayName.entries.associateWith { day(7, 3) }),
    ),
)

private fun manggarai(now: Instant) = WearStation(
    id = "KCI-MRI",
    name = "Manggarai",
    builtAt = now.toEpochMilli(),
    directions = listOf(
        WearDirection("KCI:C|E", "KCI:C", "Lin Cikarang", 0xFF25B8EB.toInt(), "Bekasi · Cikarang", "10", ServiceDayName.entries.associateWith { day(11) }),
        // Weekdays only, every two hours: on a weekend, or between trains, the clock shows instead.
        WearDirection("KCI:B|S", "KCI:B", "Lin Bogor", 0xFFEE3D43.toInt(), "Bogor", "6/7", mapOf(ServiceDayName.WD to day(120))),
    ),
)
