package id.shiorilabs.commute.wear

import android.Manifest
import android.annotation.SuppressLint
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.VibrationAttributes
import android.os.VibrationEffect
import android.os.VibratorManager
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat

/**
 * "Bangunkan Aku" on the wrist: the phone says the rider's stop is near, and the watch rings as an
 * alarm does, through silent mode, with "Udah bangun" to stop it.
 *
 * The buzz is one long waveform rather than a repeating one, so it ends by itself after [RING_MS]
 * even if this process is gone before anything can cancel it; by then the phone has joined in.
 */
object WatchAlarm {

    /** [MainActivity] opened from the alarm's card: the rider's up. */
    const val ACTION_AWAKE = "id.shiorilabs.commute.wear.AWAKE"

    private const val CHANNEL = "trip_wake"
    private const val ID = 3

    /** About a minute of [BURST]s: twice the phone's wait before it rings too. */
    private const val RING_MS = 60_000L

    /** Long and hard, then a breath, as the phone's. */
    private val BURST = longArrayOf(800, 300, 800, 300, 800, 700)

    @SuppressLint("MissingPermission") // Checked just below; without it the buzz still comes.
    fun ring(context: Context, stop: String) {
        val vibrator = context.getSystemService(VibratorManager::class.java).defaultVibrator
        val bursts = (RING_MS / BURST.sum()).toInt()
        val pattern = longArrayOf(0) + List(bursts) { BURST.toList() }.flatten().toLongArray()
        vibrator.vibrate(
            VibrationEffect.createWaveform(pattern, -1),
            VibrationAttributes.createForUsage(VibrationAttributes.USAGE_ALARM),
        )

        val granted = ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) ==
            PackageManager.PERMISSION_GRANTED
        if (!granted) return
        val manager = context.getSystemService(NotificationManager::class.java)
        if (manager.getNotificationChannel(CHANNEL) == null) {
            manager.createNotificationChannel(
                NotificationChannel(CHANNEL, context.getString(R.string.trip_wake_channel), NotificationManager.IMPORTANCE_HIGH)
                    .apply {
                        setSound(null, null)
                        enableVibration(false)
                    },
            )
        }
        val awake = PendingIntent.getBroadcast(
            context,
            0,
            Intent(context, AwakeReceiver::class.java),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        // A tap on the card opens the trip, and is as good as "Udah bangun": whoever tapped is up.
        val open = PendingIntent.getActivity(
            context,
            0,
            Intent(context, MainActivity::class.java).setAction(ACTION_AWAKE),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val notification = NotificationCompat.Builder(context, CHANNEL)
            .setSmallIcon(R.drawable.ic_launcher_monochrome)
            .setContentTitle(context.getString(R.string.trip_wake_title))
            .setContentText(context.getString(R.string.trip_wake_text, stop))
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setOngoing(true)
            .setContentIntent(open)
            .addAction(0, context.getString(R.string.trip_action_awake), awake)
            .build()
        NotificationManagerCompat.from(context).notify(ID, notification)
    }

    /** "Ingatkan Aku": one burst, as an alarm's, so it comes through silent mode. */
    fun ping(context: Context) {
        context.getSystemService(VibratorManager::class.java).defaultVibrator.vibrate(
            VibrationEffect.createWaveform(longArrayOf(0) + BURST, -1),
            VibrationAttributes.createForUsage(VibrationAttributes.USAGE_ALARM),
        )
    }

    fun silence(context: Context) {
        context.getSystemService(VibratorManager::class.java).defaultVibrator.cancel()
        NotificationManagerCompat.from(context).cancel(ID)
    }
}
