package id.shiorilabs.commute.wear

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

/** A tap on a departures slot: the station's page opens on the phone. */
class OpenStationReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        val stationId = intent.getStringExtra(EXTRA_STATION) ?: return
        val pending = goAsync()
        CoroutineScope(Dispatchers.Default).launch {
            try {
                PhoneLink(context).openStation(stationId)
            } finally {
                pending.finish()
            }
        }
    }

    companion object {

        private const val EXTRA_STATION = "station"

        fun tap(context: Context, stationId: String): PendingIntent = PendingIntent.getBroadcast(
            context,
            stationId.hashCode(),
            Intent(context, OpenStationReceiver::class.java).putExtra(EXTRA_STATION, stationId),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
    }
}
