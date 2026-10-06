package id.shiorilabs.commute.core.notification

import android.app.NotificationManager
import android.content.Context
import androidx.core.app.NotificationChannelCompat
import androidx.core.app.NotificationManagerCompat

/**
 * The app's notification channels. All belong to trip mode: the rider can silence one without the
 * others from the system settings, which is the point of having several.
 */
object NotificationChannels {

    /** The ongoing trip notification and Live Update: always there, never a sound. */
    const val TRIP_PROGRESS = "trip_progress"

    /** "Siap-siap turun", "Turun di sini": meant to be felt in a pocket. */
    const val TRIP_ALERTS = "trip_alerts"

    /**
     * "Bangunkan Aku": getting off, as an alarm. The channel itself is silent and still: the app
     * vibrates as an alarm does, which goes through silent mode where a notification's wouldn't.
     */
    const val TRIP_WAKE = "trip_wake"

    /** Two long and one short: distinct from a message, so the rider learns it means their stop. */
    val ALERT_VIBRATION = longArrayOf(0, 400, 200, 400, 200, 150)

    /** Creates the channels, or renames them after a language change. Cheap to call again. */
    fun ensure(context: Context) {
        val manager = NotificationManagerCompat.from(context)
        manager.createNotificationChannelsCompat(
            listOf(
                NotificationChannelCompat.Builder(TRIP_PROGRESS, NotificationManager.IMPORTANCE_DEFAULT)
                    .setName(context.getString(R.string.notification_channel_trip_progress))
                    .setDescription(context.getString(R.string.notification_channel_trip_progress_description))
                    .setSound(null, null)
                    .setVibrationEnabled(false)
                    .setShowBadge(false)
                    .build(),
                NotificationChannelCompat.Builder(TRIP_ALERTS, NotificationManager.IMPORTANCE_HIGH)
                    .setName(context.getString(R.string.notification_channel_trip_alerts))
                    .setDescription(context.getString(R.string.notification_channel_trip_alerts_description))
                    .setVibrationEnabled(true)
                    .setVibrationPattern(ALERT_VIBRATION)
                    .build(),
                NotificationChannelCompat.Builder(TRIP_WAKE, NotificationManager.IMPORTANCE_HIGH)
                    .setName(context.getString(R.string.notification_channel_trip_wake))
                    .setDescription(context.getString(R.string.notification_channel_trip_wake_description))
                    .setSound(null, null)
                    .setVibrationEnabled(false)
                    .build(),
            ),
        )
    }

    /**
     * Whether notifications can be shown at all (permission and the app-wide switch). Use this
     * rather than checking `POST_NOTIFICATIONS`, which only exists from Android 13: on 12 the check
     * always reads as denied, though notifications are allowed.
     */
    fun allowed(context: Context): Boolean = NotificationManagerCompat.from(context).areNotificationsEnabled()
}
