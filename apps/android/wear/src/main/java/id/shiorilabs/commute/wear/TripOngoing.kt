package id.shiorilabs.commute.wear

import android.Manifest
import android.annotation.SuppressLint
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.wear.ongoing.OngoingActivity
import androidx.wear.ongoing.Status
import id.shiorilabs.commute.core.trip.Headline
import id.shiorilabs.commute.core.trip.headline
import id.shiorilabs.commute.core.wearable.WearTrip
import java.time.Instant

/**
 * The trip on the watch face and in the recents while it runs: an Ongoing Activity, on a silent
 * notification. The phone's alerts still reach the wrist through its own bridged notifications, so
 * this one never buzzes.
 */
object TripOngoing {

    private const val CHANNEL = "trip"
    private const val ID = 1

    /** One buzz as a trip starts, which the ongoing notification itself never gives. */
    private const val START_CHANNEL = "trip_start"
    private const val START_ID = 2

    /** How long "OTW dimulai" stays, if it isn't tapped: the app's open by then, or not wanted. */
    private const val START_SHOWN_MS = 60_000L

    /**
     * Buzzes once for a trip that just started on the phone, with "OTW dimulai" and the headline: a
     * tap away from the app should the phone not have been able to open it.
     */
    @SuppressLint("MissingPermission") // Checked just below; without it nothing is posted.
    fun announceStart(context: Context, trip: WearTrip) {
        val granted = ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) ==
            PackageManager.PERMISSION_GRANTED
        if (!granted) return
        val manager = context.getSystemService(NotificationManager::class.java)
        if (manager.getNotificationChannel(START_CHANNEL) == null) {
            manager.createNotificationChannel(
                NotificationChannel(START_CHANNEL, context.getString(R.string.trip_start_channel), NotificationManager.IMPORTANCE_HIGH),
            )
        }
        val copy = WatchCopy(context.resources, trip.lines)
        val notification = NotificationCompat.Builder(context, START_CHANNEL)
            .setSmallIcon(R.drawable.ic_launcher_monochrome)
            .setContentTitle(context.getString(R.string.trip_started))
            .setContentText(copy.title(trip.state.headline(trip.plan)))
            .setContentIntent(openApp(context))
            .setAutoCancel(true)
            .setTimeoutAfter(START_SHOWN_MS)
            .setCategory(NotificationCompat.CATEGORY_NAVIGATION)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .build()
        NotificationManagerCompat.from(context).notify(START_ID, notification)
    }

    @SuppressLint("MissingPermission") // Checked just below; without it nothing is posted.
    fun show(context: Context, trip: WearTrip) {
        val granted = ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) ==
            PackageManager.PERMISSION_GRANTED
        if (!granted) return
        ensureChannel(context)

        val copy = WatchCopy(context.resources, trip.lines)
        val headline = trip.state.headline(trip.plan)
        val now = Instant.now()
        val open = openApp(context)
        val builder = NotificationCompat.Builder(context, CHANNEL)
            .setSmallIcon(R.drawable.ic_launcher_monochrome)
            .setContentTitle(copy.title(headline))
            .setContentText(copy.summary(trip.state, headline, now))
            .setContentIntent(open)
            .setCategory(NotificationCompat.CATEGORY_NAVIGATION)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setSilent(true)

        OngoingActivity.Builder(context, ID, builder)
            .setStaticIcon(R.drawable.ic_launcher_monochrome)
            .setTouchIntent(open)
            .setStatus(status(context, headline, now))
            .build()
            .apply(context)

        NotificationManagerCompat.from(context).notify(ID, builder.build())
    }

    private fun openApp(context: Context): PendingIntent = PendingIntent.getActivity(
        context,
        0,
        Intent(context, MainActivity::class.java),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )

    fun hide(context: Context) {
        NotificationManagerCompat.from(context).cancel(ID)
    }

    /** A few characters: a countdown to the train while waiting, the stops left while riding. */
    private fun status(context: Context, headline: Headline, now: Instant): Status {
        val departsAt = when (headline) {
            is Headline.Board -> headline.departsAt
            is Headline.Change -> headline.departsAt
            else -> null
        }
        if (departsAt != null && departsAt.isAfter(now)) {
            return Status.Builder()
                .addTemplate(context.getString(R.string.trip_chip_board_timer))
                .addPart("t", Status.TimerPart(departsAt.toEpochMilli()))
                .build()
        }
        val text = when (headline) {
            is Headline.Board, is Headline.Change -> context.getString(R.string.trip_chip_board)
            is Headline.RideTo -> context.getString(R.string.trip_chip_stops, headline.stopsLeft)
            is Headline.AlightNow, is Headline.Arrived -> context.getString(R.string.trip_chip_alight)
        }
        return Status.forPart(Status.TextPart(text))
    }

    private fun ensureChannel(context: Context) {
        val manager = context.getSystemService(NotificationManager::class.java)
        if (manager.getNotificationChannel(CHANNEL) != null) return
        manager.createNotificationChannel(
            NotificationChannel(CHANNEL, context.getString(R.string.trip_channel), NotificationManager.IMPORTANCE_LOW),
        )
    }
}
