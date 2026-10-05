package id.shiorilabs.commute.wear

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

/** "Udah bangun" on the watch's alarm: it stops, and the phone is told so it needn't ring too. */
class AwakeReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        WatchAlarm.silence(context)
        val pending = goAsync()
        CoroutineScope(Dispatchers.Default).launch {
            try {
                PhoneLink(context).ackWake()
            } finally {
                pending.finish()
            }
        }
    }
}
