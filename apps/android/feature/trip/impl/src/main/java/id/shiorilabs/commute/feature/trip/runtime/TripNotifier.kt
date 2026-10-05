package id.shiorilabs.commute.feature.trip.runtime

import android.Manifest
import android.annotation.SuppressLint
import android.app.Notification
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.core.graphics.drawable.IconCompat
import androidx.core.graphics.toColorInt
import dagger.hilt.android.qualifiers.ApplicationContext
import id.shiorilabs.commute.core.navigation.ACTIVE_TRIP_LINK
import id.shiorilabs.commute.core.notification.NotificationChannels
import id.shiorilabs.commute.core.trip.AlertKind
import id.shiorilabs.commute.core.trip.PositionSource
import id.shiorilabs.commute.core.trip.TripEffect
import id.shiorilabs.commute.core.trip.TripLeg
import id.shiorilabs.commute.core.trip.TripPhase
import id.shiorilabs.commute.core.trip.expectedAlightingAt
import id.shiorilabs.commute.core.trip.progress
import id.shiorilabs.commute.feature.station.data.LineRepository
import id.shiorilabs.commute.feature.trip.ActiveTrip
import id.shiorilabs.commute.feature.trip.R
import id.shiorilabs.commute.feature.trip.presentation.Headline
import id.shiorilabs.commute.feature.trip.presentation.TripCopy
import id.shiorilabs.commute.feature.trip.presentation.formatClock
import id.shiorilabs.commute.feature.trip.presentation.headline
import id.shiorilabs.commute.feature.trip.presentation.minutesUntil
import java.time.Clock
import java.time.Instant
import javax.inject.Inject
import javax.inject.Singleton
import kotlin.math.roundToInt

/**
 * Puts the trip on the lock screen and taps the rider's wrist: the ongoing notification, promoted to
 * a Live Update where the system supports it (a plain ongoing notification with a progress bar
 * below that), and the alerts.
 */
@Singleton
class TripNotifier @Inject constructor(
    @param:ApplicationContext private val context: Context,
    private val lines: LineRepository,
    private val clock: Clock,
) {

    private val manager = NotificationManagerCompat.from(context)

    /** The ongoing notification for [trip], also what the foreground service starts with. */
    fun progress(trip: ActiveTrip): Notification {
        NotificationChannels.ensure(context)
        val headline = trip.headline()
        val progress = trip.state.progress(trip.plan)
        val copy = copy()

        val builder = NotificationCompat.Builder(context, NotificationChannels.TRIP_PROGRESS)
            .setSmallIcon(R.drawable.ic_stat_trip)
            .setContentTitle(copy.title(headline))
            .setContentText(copy.detail(trip, headline))
            .setSubText(copy.source(trip))
            .setContentIntent(openTrip())
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setShowWhen(false)
            .setCategory(NotificationCompat.CATEGORY_NAVIGATION)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setRequestPromotedOngoing(true)
            .setShortCriticalText(copy.chip(headline))
            .setStyle(progressStyle(trip, progress.fraction, progress.source))
            .addAction(0, context.getString(R.string.trip_action_stop), action(TripReceiver.ACTION_STOP))

        when {
            headline is Headline.AlightNow ||
                (headline is Headline.RideTo && headline.stopsLeft <= 1) ->
                builder.addAction(0, context.getString(R.string.trip_action_alighted), action(TripReceiver.ACTION_ALIGHTED))
            trip.state.phase == TripPhase.WAITING_TO_BOARD ->
                builder.addAction(0, context.getString(R.string.trip_action_boarded), action(TripReceiver.ACTION_BOARDED))
        }
        return builder.build()
    }

    fun showProgress(trip: ActiveTrip) = notify(PROGRESS_ID, progress(trip))

    fun alert(trip: ActiveTrip, alert: TripEffect.Alert) {
        val ride = trip.plan.ride(alert.legIndex)
        val alighting = ride.stops.last().name
        val stops = if (ride.isBus) R.string.trip_alert_prepare_halte else R.string.trip_alert_prepare_station
        val (title, text) = when (alert.kind) {
            AlertKind.PREPARE -> if (alert.estimated) {
                val minutes = trip.state.expectedAlightingAt(trip.plan)?.let { minutesUntil(clock.instant(), it) }
                context.getString(R.string.trip_alert_prepare_estimated_title) to (
                    minutes?.let { context.getString(R.string.trip_alert_prepare_estimated, it, alighting) }
                        ?: context.getString(R.string.trip_alert_prepare_estimated_untimed, alighting)
                    )
            } else {
                context.getString(R.string.trip_alert_prepare_title) to context.getString(stops, alighting)
            }
            AlertKind.ALIGHT -> {
                val then = trip.plan.nextRideAfter(alert.legIndex)?.let(trip.plan::ride)
                val next = then?.let { context.getString(R.string.trip_then_change, rideName(it)) }
                    ?: context.getString(R.string.trip_then_done)
                if (alert.estimated) {
                    context.getString(R.string.trip_alert_alight_estimated_title) to
                        context.getString(R.string.trip_alert_alight_estimated, alighting) + sep() + next
                } else {
                    context.getString(R.string.trip_alert_alight_title) to alighting + sep() + next
                }
            }
            AlertKind.MISSED ->
                context.getString(R.string.trip_alert_missed_title) to context.getString(R.string.trip_alert_missed, alighting)
            AlertKind.NO_REMINDERS ->
                context.getString(R.string.trip_alert_no_reminders_title) to
                    context.getString(R.string.trip_alert_no_reminders, alighting, ride.lastIndex)
        }
        notify(ALERT_ID, alertBuilder(title, text).build())
    }

    fun askStillOnRoute(trip: ActiveTrip) {
        val ride = trip.plan.ride(trip.state.legIndex)
        val notification = alertBuilder(
            context.getString(R.string.trip_ask_still_on_route_title),
            context.getString(R.string.trip_ask_still_on_route, rideName(ride)),
        )
            .addAction(0, context.getString(R.string.trip_action_still_on_route), action(TripReceiver.ACTION_STILL_ON_ROUTE))
            .addAction(0, context.getString(R.string.trip_action_stop), action(TripReceiver.ACTION_STOP))
            .build()
        notify(ASK_ID, notification)
    }

    /** The ride waited for left at [missed]: which one to take instead, and when it goes. */
    fun rerouted(trip: ActiveTrip, missed: Instant) {
        val ride = trip.plan.ride(trip.state.legIndex)
        val departs = ride.departureAt?.let(::formatClock) ?: return
        notify(
            ALERT_ID,
            alertBuilder(
                context.getString(R.string.trip_alert_rerouted_title, departs),
                context.getString(R.string.trip_alert_rerouted, formatClock(missed), rideName(ride), departs, ride.stops.first().name),
            ).build(),
        )
    }

    /** The trip is over: the ongoing notification and any question about it go. Alerts stay. */
    fun finish() {
        manager.cancel(PROGRESS_ID)
        manager.cancel(ASK_ID)
    }

    private fun alertBuilder(title: String, text: String) =
        NotificationCompat.Builder(context, NotificationChannels.TRIP_ALERTS)
            .also { NotificationChannels.ensure(context) }
            .setSmallIcon(R.drawable.ic_stat_trip)
            .setContentTitle(title)
            .setContentText(text)
            .setStyle(NotificationCompat.BigTextStyle().bigText(text))
            .setContentIntent(openTrip())
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setVibrate(NotificationChannels.ALERT_VIBRATION)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)

    /**
     * One segment per ride in its line's colour, a point at each change, and the tracker solid when a
     * fix places the rider and hollow when it is the timetable's guess.
     */
    private fun progressStyle(trip: ActiveTrip, fraction: Double, source: PositionSource): NotificationCompat.ProgressStyle {
        val rides = trip.plan.rideIndices.map(trip.plan::ride)
        val lengths = rides.map { it.lastIndex * SEGMENT_UNIT }
        val total = lengths.sum()
        val style = NotificationCompat.ProgressStyle()
            .setStyledByProgress(true)
            .setProgressSegments(rides.zip(lengths) { ride, length -> NotificationCompat.ProgressStyle.Segment(length).setColor(colorOf(ride)) })
            .setProgress((fraction * total).roundToInt())
            .setProgressTrackerIcon(
                IconCompat.createWithResource(
                    context,
                    if (source == PositionSource.CONFIRMED) R.drawable.ic_trip_tracker else R.drawable.ic_trip_tracker_estimated,
                ),
            )
        var at = 0
        lengths.dropLast(1).forEach { length ->
            at += length
            style.addProgressPoint(NotificationCompat.ProgressStyle.Point(at).setColor(CHANGE_POINT))
        }
        return style
    }

    private fun copy() = TripCopy(context.resources, lines.cachedLines().orEmpty())

    private fun rideName(ride: TripLeg.Ride): String = copy().rideName(ride)

    private fun colorOf(ride: TripLeg.Ride): Int =
        lines.cachedLines()?.get(ride.line)?.colorCode?.let { runCatching { it.toColorInt() }.getOrNull() } ?: FALLBACK_LINE

    private fun sep() = copy().separator

    private fun openTrip(): PendingIntent {
        val launch = context.packageManager.getLaunchIntentForPackage(context.packageName)
            ?.setAction(Intent.ACTION_VIEW)
            ?.setData(Uri.parse(ACTIVE_TRIP_LINK))
            ?.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP)
            ?: Intent()
        return PendingIntent.getActivity(context, 0, launch, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    }

    private fun action(name: String): PendingIntent = TripReceiver.pendingIntent(context, name)

    @SuppressLint("MissingPermission") // Checked just above; without it nothing is posted.
    private fun notify(id: Int, notification: Notification) {
        val granted = ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) ==
            PackageManager.PERMISSION_GRANTED
        if (granted) manager.notify(id, notification)
    }

    companion object {

        const val PROGRESS_ID = 41
        private const val ALERT_ID = 42
        private const val ASK_ID = 43

        /** Segment lengths are in stops; this keeps a one-stop ride a visible share of the bar. */
        private const val SEGMENT_UNIT = 100

        private val FALLBACK_LINE = 0xFF64748B.toInt()
        private val CHANGE_POINT = 0xFF0F172A.toInt()
    }
}
