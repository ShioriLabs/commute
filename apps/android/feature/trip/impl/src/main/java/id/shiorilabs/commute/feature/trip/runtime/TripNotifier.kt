package id.shiorilabs.commute.feature.trip.runtime

import android.Manifest
import android.annotation.SuppressLint
import android.app.Notification
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import androidx.compose.ui.graphics.toArgb
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.core.graphics.drawable.IconCompat
import androidx.core.graphics.toColorInt
import dagger.hilt.android.qualifiers.ApplicationContext
import id.shiorilabs.commute.core.navigation.ACTIVE_TRIP_LINK
import id.shiorilabs.commute.core.notification.NotificationChannels
import id.shiorilabs.commute.core.trip.AlertKind
import id.shiorilabs.commute.core.ui.theme.CommuteColors
import id.shiorilabs.commute.core.trip.PositionSource
import id.shiorilabs.commute.core.trip.TripEffect
import id.shiorilabs.commute.core.trip.TripLeg
import id.shiorilabs.commute.core.trip.TripPhase
import id.shiorilabs.commute.core.trip.expectedAlightingAt
import id.shiorilabs.commute.core.trip.progress
import id.shiorilabs.commute.feature.station.data.LineRepository
import id.shiorilabs.commute.feature.trip.ActiveTrip
import id.shiorilabs.commute.feature.trip.R
import id.shiorilabs.commute.core.trip.Headline
import id.shiorilabs.commute.feature.trip.presentation.TripCopy
import id.shiorilabs.commute.feature.trip.presentation.formatClock
import id.shiorilabs.commute.feature.trip.presentation.headline
import id.shiorilabs.commute.core.trip.minutesUntil
import java.time.Clock
import java.time.Duration
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

    /** A ride of this trip swapped for a later one: its leg, and when the one missed left. */
    private class Reroute(val startedAt: Instant, val legIndex: Int, val missed: Instant)

    /** The last "Turun di sini": for which trip and ride, how sure, and when. */
    private class Alighted(val startedAt: Instant, val legIndex: Int, val estimated: Boolean, val at: Instant)

    private var reroute: Reroute? = null
    private var alighted: Alighted? = null

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
            .setColor(chipColor(headline))
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
                alighted = Alighted(trip.state.startedAt, alert.legIndex, alert.estimated, clock.instant())
                // Any word of a change missed is in this one now.
                manager.cancel(REROUTE_ID)
                alight(trip, alert.legIndex, alert.estimated)
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

    /**
     * Ride [legIndex], leaving at [missed], was swapped for a later one. Still aboard the ride before:
     * which one to take instead, and when, as a notice of its own beside the alerts. Just off it, with
     * "Turun di sini" still up: that alert takes the news, quietly, rather than being replaced by it.
     */
    fun rerouted(trip: ActiveTrip, legIndex: Int, missed: Instant) {
        reroute = Reroute(trip.state.startedAt, legIndex, missed)
        val ride = trip.plan.ride(legIndex)
        val departs = ride.departureAt?.let(::formatClock) ?: return
        val previous = trip.plan.rideIndices.lastOrNull { it < legIndex }
        val justOff = alighted?.takeIf {
            it.startedAt == trip.state.startedAt && it.legIndex == previous &&
                Duration.between(it.at, clock.instant()) < JUST_OFF
        }
        if (justOff != null && previous != null) {
            val (title, text) = alight(trip, previous, justOff.estimated)
            notify(ALERT_ID, alertBuilder(title, text).setOnlyAlertOnce(true).build())
            return
        }
        val text = if (trip.state.phase == TripPhase.RIDING) R.string.trip_alert_rerouted_ahead else R.string.trip_alert_rerouted
        notify(
            REROUTE_ID,
            alertBuilder(
                context.getString(R.string.trip_alert_rerouted_title, departs),
                context.getString(text, formatClock(missed), rideName(ride), departs, ride.stops.first().name),
            ).build(),
        )
    }

    /**
     * "Turun di sini" for ride [legIndex]: where, and what then. A change names the ride and when it
     * leaves, and the one it stands in for when that was missed.
     */
    private fun alight(trip: ActiveTrip, legIndex: Int, estimated: Boolean): Pair<String, String> {
        val alighting = trip.plan.ride(legIndex).stops.last().name
        val thenIndex = trip.plan.nextRideAfter(legIndex)
        val next = thenIndex?.let { index ->
            val then = trip.plan.ride(index)
            val departs = then.departureAt?.let(::formatClock)
            val missed = reroute?.takeIf { it.startedAt == trip.state.startedAt && it.legIndex == index }
                ?.let { context.getString(R.string.trip_then_missed, formatClock(it.missed)) }
                .orEmpty()
            if (departs == null) {
                context.getString(R.string.trip_then_change, rideName(then))
            } else {
                context.getString(R.string.trip_then_change_at, rideName(then), departs) + missed
            }
        } ?: context.getString(R.string.trip_then_done)
        return if (estimated) {
            context.getString(R.string.trip_alert_alight_estimated_title) to
                context.getString(R.string.trip_alert_alight_estimated, alighting) + sep() + next
        } else {
            context.getString(R.string.trip_alert_alight_title) to alighting + sep() + next
        }
    }

    /**
     * The trip is over: the ongoing notification, any question about it and its alerts go, so a
     * "turun sekarang" or "kelewatan?" doesn't outlive the trip. On arrival that is once the trip
     * has lingered at the station, so the last alert is still there while the rider gets off.
     */
    fun finish() {
        manager.cancel(PROGRESS_ID)
        manager.cancel(ASK_ID)
        manager.cancel(ALERT_ID)
        manager.cancel(REROUTE_ID)
        reroute = null
        alighted = null
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

    private fun colorOf(ride: TripLeg.Ride): Int = lineColorOrNull(ride) ?: FALLBACK_LINE

    private fun lineColorOrNull(ride: TripLeg.Ride): Int? =
        lines.cachedLines()?.get(ride.line)?.colorCode?.let { runCatching { it.toColorInt() }.getOrNull() }

    /** The chip follows the line the headline is about: the one being ridden, or boarded next. */
    private fun chipColor(headline: Headline): Int {
        val ride = when (headline) {
            is Headline.Board -> headline.ride
            is Headline.Change -> headline.ride
            is Headline.RideTo -> headline.ride
            is Headline.AlightNow -> headline.ride
            is Headline.Arrived -> null
        }
        return ride?.let(::lineColorOrNull) ?: BRAND
    }

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
        private const val REROUTE_ID = 44

        /** How long after "Turun di sini" news of a missed change goes into it instead of its own. */
        private val JUST_OFF: Duration = Duration.ofMinutes(3)

        /** Segment lengths are in stops; this keeps a one-stop ride a visible share of the bar. */
        private const val SEGMENT_UNIT = 100

        private val FALLBACK_LINE = 0xFF64748B.toInt()
        private val BRAND = CommuteColors.primaryLight.toArgb()
        private val CHANGE_POINT = 0xFF0F172A.toInt()
    }
}
