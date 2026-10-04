package id.shiorilabs.commute.feature.trip.runtime

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import dagger.hilt.android.AndroidEntryPoint
import id.shiorilabs.commute.core.query.di.ApplicationScope
import id.shiorilabs.commute.core.trip.RiderAction
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * The trip's ticks while the phone dozes (an alarm, which wakes the process if it was killed), and
 * the notification's buttons. Not exported: only the app's own pending intents reach it.
 */
@AndroidEntryPoint
class TripReceiver : BroadcastReceiver() {

    @Inject
    lateinit var controller: TripControllerImpl

    @Inject
    @ApplicationScope
    lateinit var scope: CoroutineScope

    override fun onReceive(context: Context, intent: Intent) {
        val pending = goAsync()
        scope.launch {
            try {
                when (intent.action) {
                    ACTION_TICK -> controller.tick()
                    ACTION_STOP -> controller.say(RiderAction.STOP)
                    ACTION_ALIGHTED -> controller.say(RiderAction.ALIGHTED)
                    ACTION_BOARDED -> controller.say(RiderAction.BOARDED)
                    ACTION_STILL_ON_ROUTE -> controller.say(RiderAction.STILL_ON_ROUTE)
                }
            } finally {
                pending.finish()
            }
        }
    }

    companion object {

        const val ACTION_TICK = "id.shiorilabs.commute.trip.TICK"
        const val ACTION_STOP = "id.shiorilabs.commute.trip.STOP"
        const val ACTION_ALIGHTED = "id.shiorilabs.commute.trip.ALIGHTED"
        const val ACTION_BOARDED = "id.shiorilabs.commute.trip.BOARDED"
        const val ACTION_STILL_ON_ROUTE = "id.shiorilabs.commute.trip.STILL_ON_ROUTE"

        fun pendingIntent(context: Context, action: String): PendingIntent = PendingIntent.getBroadcast(
            context,
            action.hashCode(),
            Intent(context, TripReceiver::class.java).setAction(action),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
    }
}
