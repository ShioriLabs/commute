package id.shiorilabs.commute.feature.trip.runtime

import android.annotation.SuppressLint
import android.content.Context
import android.media.AudioAttributes
import android.os.Build
import android.os.VibrationAttributes
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.google.android.gms.wearable.CapabilityClient
import com.google.android.gms.wearable.Wearable
import dagger.hilt.android.qualifiers.ApplicationContext
import id.shiorilabs.commute.core.notification.NotificationChannels
import id.shiorilabs.commute.core.query.di.ApplicationScope
import id.shiorilabs.commute.core.wearable.WearPaths
import id.shiorilabs.commute.feature.trip.ActiveTrip
import id.shiorilabs.commute.feature.trip.R
import id.shiorilabs.commute.feature.trip.TripReminder
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withTimeoutOrNull
import java.time.Duration
import javax.inject.Inject
import javax.inject.Singleton

/**
 * A trip's reminder for getting off ("Tambah Pengingat"), on the watch when one's in reach, else
 * the phone:
 * - "Ingatkan Aku": one hard buzz.
 * - "Bangunkan Aku", for a rider asleep on the train: the watch rings as an alarm; if nobody answers
 *   it for [ESCALATE_AFTER] (off the wrist, flat, slept through), the phone rings too, or straight
 *   away with no watch. Either rings until "Udah bangun", getting off, or [RING_FOR] has passed.
 *
 * The phone's buzz is an alarm's, so it goes through silent mode and Do Not Disturb, which a
 * notification's vibration doesn't; the alarm's notification is only there to show why, and to
 * stop it.
 */
@Singleton
class TripWaker @Inject constructor(
    @param:ApplicationContext private val context: Context,
    @param:ApplicationScope private val scope: CoroutineScope,
) {

    private val vibrator: Vibrator by lazy {
        context.getSystemService(VibratorManager::class.java).defaultVibrator
    }

    /** The ride last reminded about, as `startedAt:leg`, so each ride is reminded about once. */
    private var remindedFor: String? = null
    private var ringing: Job? = null

    fun remind(trip: ActiveTrip, legIndex: Int) {
        if (trip.reminder == TripReminder.NONE) return
        val key = "${trip.state.startedAt.toEpochMilli()}:$legIndex"
        if (key == remindedFor) return
        remindedFor = key
        val stop = trip.plan.ride(legIndex).stops.last().name
        when (trip.reminder) {
            TripReminder.PING -> scope.launch { if (!tellWatch(WearPaths.PING, stop)) vibrate() }
            TripReminder.WAKE -> {
                ringing?.cancel()
                ringing = scope.launch {
                    if (tellWatch(WearPaths.WAKE, stop)) delay(ESCALATE_AFTER.toMillis())
                    ringPhone(stop)
                }
            }
            TripReminder.NONE -> Unit
        }
    }

    /**
     * The rider's up. [tellWatch] off when the watch is the one that said so, and has stopped
     * itself already.
     */
    fun stop(tellWatch: Boolean = true) {
        val wasRinging = ringing?.isActive == true
        ringing?.cancel()
        ringing = null
        if (wasRinging && tellWatch) scope.launch { tellWatch(WearPaths.WAKE_STOP, "") }
    }

    /** Rings until cancelled or [RING_FOR] is up, a burst at a time; the notification says why. */
    private suspend fun ringPhone(stop: String) {
        showAlarm(stop)
        try {
            withTimeoutOrNull(RING_FOR.toMillis()) {
                while (true) {
                    vibrate()
                    delay(BURST.sumOf { it })
                }
            }
        } finally {
            vibrator.cancel()
            NotificationManagerCompat.from(context).cancel(ALARM_ID)
        }
    }

    private fun vibrate() {
        val effect = VibrationEffect.createWaveform(BURST, -1)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            vibrator.vibrate(effect, VibrationAttributes.createForUsage(VibrationAttributes.USAGE_ALARM))
        } else {
            @Suppress("DEPRECATION")
            vibrator.vibrate(effect, AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).build())
        }
    }

    @SuppressLint("MissingPermission") // Checked just below; without it the buzz still comes.
    private fun showAlarm(stop: String) {
        if (!NotificationChannels.allowed(context)) return
        NotificationChannels.ensure(context)
        val notification = NotificationCompat.Builder(context, NotificationChannels.TRIP_WAKE)
            .setSmallIcon(R.drawable.ic_stat_trip)
            .setContentTitle(context.getString(R.string.trip_wake_title))
            .setContentText(context.getString(R.string.trip_wake_text, stop))
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOngoing(true)
            .setContentIntent(TripReceiver.pendingIntent(context, TripReceiver.ACTION_AWAKE))
            .addAction(0, context.getString(R.string.trip_action_awake), TripReceiver.pendingIntent(context, TripReceiver.ACTION_AWAKE))
            .build()
        NotificationManagerCompat.from(context).notify(ALARM_ID, notification)
    }

    /** Sends [path] to every watch in reach running the app; `false` when there was none to tell. */
    private suspend fun tellWatch(path: String, payload: String): Boolean = runCatching {
        val watches = Wearable.getCapabilityClient(context)
            .getCapability(WearPaths.WEAR_CAPABILITY, CapabilityClient.FILTER_REACHABLE)
            .await()
            .nodes
        val messages = Wearable.getMessageClient(context)
        watches.map { runCatching { messages.sendMessage(it.id, path, payload.encodeToByteArray()).await() }.isSuccess }
            .any { it }
    }.getOrDefault(false)

    private companion object {

        const val ALARM_ID = 44

        /** How long the watch rings alone before the phone joins in. */
        val ESCALATE_AFTER: Duration = Duration.ofSeconds(30)

        /** How long an unanswered alarm rings: past the stop by then, and only draining the battery. */
        val RING_FOR: Duration = Duration.ofMinutes(5)

        /** Long and hard, then a breath: an alarm, not a message. */
        val BURST = longArrayOf(0, 800, 300, 800, 300, 800, 700)
    }
}
