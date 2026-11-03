package id.shiorilabs.commute.feature.trip.runtime

import android.annotation.SuppressLint
import android.app.Notification
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.compose.ui.graphics.toArgb
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.graphics.drawable.IconCompat
import androidx.core.graphics.toColorInt
import dagger.hilt.android.qualifiers.ApplicationContext
import id.shiorilabs.commute.core.datastore.OtwPreferencesRepository
import id.shiorilabs.commute.core.navigation.ACTIVE_TRIP_LINK
import id.shiorilabs.commute.core.notification.NotificationChannels
import id.shiorilabs.commute.core.query.di.ApplicationScope
import id.shiorilabs.commute.core.time.formatClock
import id.shiorilabs.commute.core.trip.AlertKind
import id.shiorilabs.commute.core.tripcopy.R as CopyR
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
import id.shiorilabs.commute.feature.trip.TripReminder
import id.shiorilabs.commute.core.trip.Headline
import id.shiorilabs.commute.feature.trip.presentation.TripCopy
import id.shiorilabs.commute.feature.trip.presentation.headline
import id.shiorilabs.commute.core.trip.minutesUntil
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.stateIn
import java.time.Clock
import java.time.Duration
import java.time.Instant
import java.util.concurrent.ConcurrentHashMap
import javax.inject.Inject
import javax.inject.Singleton
import kotlin.math.roundToInt

/**
 * Where "Turun di sini" goes: with the tune on, the silent channel, as the doors' chime plays then;
 * a rider being woken has the alarm instead, so theirs sounds as any other alert.
 */
internal fun alightChannel(tune: Boolean, reminder: TripReminder): String =
    if (tune && reminder != TripReminder.WAKE) NotificationChannels.TRIP_ALIGHT else NotificationChannels.TRIP_ALERTS

/** What was last put up, so the same again needn't be: a post is a call to the system, and a redraw of it. */
internal class LastPosted<T : Any> {

    private var last: T? = null

    /** Whether [value] differs from what's up, and if so it's what's up now. */
    @Synchronized
    fun changed(value: T): Boolean {
        if (value == last) return false
        last = value
        return true
    }

    /** [value] went up some other way, as the foreground service's start. */
    @Synchronized
    fun record(value: T) {
        last = value
    }

    /** Taken down: whatever comes next goes up. */
    @Synchronized
    fun clear() {
        last = null
    }
}

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
    preferences: OtwPreferencesRepository,
    @ApplicationScope scope: CoroutineScope,
) {

    private val manager = NotificationManagerCompat.from(context)

    /** "Mainkan nada pengingat", read ahead: "turun" can't wait on the disk. On, as it starts, till read. */
    private val tune = preferences.reminderTune.stateIn(scope, SharingStarted.Eagerly, true)

    /** A ride of this trip swapped for a later one: its leg, and when the one missed left. */
    private class Reroute(val startedAt: Instant, val legIndex: Int, val missed: Instant)

    /** The last "Turun di sini": for which trip and ride, how sure, and when. */
    private class Alighted(val startedAt: Instant, val legIndex: Int, val estimated: Boolean, val at: Instant)

    private var reroute: Reroute? = null
    private var alighted: Alighted? = null

    /** The channels made, once a process: making them again is a call to the system each time. */
    @Volatile
    private var channelsReady = false

    /** The trip page, opened from any of the trip's notifications: the same intent every time. */
    private val openTrip: PendingIntent by lazy {
        val launch = context.packageManager.getLaunchIntentForPackage(context.packageName)
            ?.setAction(Intent.ACTION_VIEW)
            ?.setData(Uri.parse(ACTIVE_TRIP_LINK))
            ?.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP)
            ?: Intent()
        PendingIntent.getActivity(context, 0, launch, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    }

    /** The buttons' intents, by action, each made once. */
    private val actions = ConcurrentHashMap<String, PendingIntent>()

    /** The ongoing notification as last put up: a fix that changes nothing on it isn't posted again. */
    private val lastProgress = LastPosted<ProgressContent>()

    /**
     * What the ongoing notification shows, and nothing it doesn't: two equal ones look the same.
     * [action] is the button beside "Berhenti", as its label and [TripReceiver] action.
     */
    private data class ProgressContent(
        val icon: Int,
        val title: String,
        val text: String,
        val subText: String?,
        val chip: String,
        val color: Int,
        /** Each ride's segment, as its length and colour. */
        val segments: List<Pair<Int, Int>>,
        val progress: Int,
        val tracker: Int,
        val action: Pair<Int, String>?,
    )

    /** The ongoing notification for [trip], also what the foreground service starts with. */
    fun progress(trip: ActiveTrip): Notification {
        val content = progressContent(trip)
        lastProgress.record(content)
        return build(content)
    }

    fun showProgress(trip: ActiveTrip) {
        val content = progressContent(trip)
        if (lastProgress.changed(content)) notify(PROGRESS_ID, build(content))
    }

    private fun progressContent(trip: ActiveTrip): ProgressContent {
        val headline = trip.headline()
        val progress = trip.state.progress(trip.plan)
        val copy = copy()
        // "Turun sekarang" or one stop to go: the rider is about to get off.
        val alighting = headline is Headline.AlightNow ||
            (headline is Headline.RideTo && headline.stopsLeft <= 1)
        val waiting = trip.state.phase == TripPhase.WAITING_TO_BOARD
        val rides = trip.plan.rideIndices.map(trip.plan::ride)
        val segments = rides.map { it.lastIndex * SEGMENT_UNIT to colorOf(it) }
        return ProgressContent(
            icon = when {
                alighting -> CopyR.drawable.ic_stat_alight
                waiting -> CopyR.drawable.ic_stat_boarding
                else -> R.drawable.ic_stat_trip
            },
            title = copy.title(headline),
            text = copy.detail(trip, headline, clock.instant()),
            subText = copy.source(trip),
            chip = copy.chip(headline),
            color = chipColor(headline),
            segments = segments,
            progress = (progress.fraction * segments.sumOf { it.first }).roundToInt(),
            tracker = if (progress.source == PositionSource.CONFIRMED) R.drawable.ic_trip_tracker else R.drawable.ic_trip_tracker_estimated,
            action = when {
                alighting -> CopyR.string.trip_action_alighted to TripReceiver.ACTION_ALIGHTED
                waiting -> CopyR.string.trip_action_boarded to TripReceiver.ACTION_BOARDED
                else -> null
            },
        )
    }

    private fun build(content: ProgressContent): Notification {
        ensureChannels()
        val builder = NotificationCompat.Builder(context, NotificationChannels.TRIP_PROGRESS)
            .setSmallIcon(content.icon)
            .setContentTitle(content.title)
            .setContentText(content.text)
            .setSubText(content.subText)
            .setContentIntent(openTrip)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setShowWhen(false)
            .setCategory(NotificationCompat.CATEGORY_NAVIGATION)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setRequestPromotedOngoing(true)
            .setShortCriticalText(content.chip)
            .setColor(content.color)
            .setStyle(progressStyle(content))
            .addAction(0, context.getString(CopyR.string.trip_action_stop), action(TripReceiver.ACTION_STOP))
        content.action?.let { (label, name) -> builder.addAction(0, context.getString(label), action(name)) }
        return builder.build()
    }

    fun alert(trip: ActiveTrip, alert: TripEffect.Alert) {
        val ride = trip.plan.ride(alert.legIndex)
        val alighting = ride.stops.last().name
        val stops = if (ride.isBus) R.string.trip_alert_prepare_halte else R.string.trip_alert_prepare_station
        val channel = if (alert.kind == AlertKind.ALIGHT) alightChannel(tune.value, trip.reminder) else NotificationChannels.TRIP_ALERTS
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
        val icon = when (alert.kind) {
            AlertKind.PREPARE, AlertKind.ALIGHT -> CopyR.drawable.ic_stat_alight
            AlertKind.MISSED, AlertKind.NO_REMINDERS -> R.drawable.ic_stat_trip
        }
        notify(ALERT_ID, alertBuilder(title, text, icon, channel).build())
    }

    fun askStillOnRoute(trip: ActiveTrip) {
        val ride = trip.plan.ride(trip.state.legIndex)
        val notification = alertBuilder(
            context.getString(R.string.trip_ask_still_on_route_title),
            context.getString(R.string.trip_ask_still_on_route, rideName(ride)),
        )
            .addAction(0, context.getString(CopyR.string.trip_action_still_on_route), action(TripReceiver.ACTION_STILL_ON_ROUTE))
            .addAction(0, context.getString(CopyR.string.trip_action_stop), action(TripReceiver.ACTION_STOP))
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
            notify(ALERT_ID, alertBuilder(title, text, CopyR.drawable.ic_stat_alight).setOnlyAlertOnce(true).build())
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
     * Ride [legIndex] was made after all, late: "naik yang … aja" would only be wrong now, so it goes,
     * and "Turun di sini" no longer names it as missed.
     */
    fun rerouteTakenBack(legIndex: Int) {
        if (reroute?.legIndex != legIndex) return
        reroute = null
        manager.cancel(REROUTE_ID)
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
                context.getString(CopyR.string.trip_then_change, rideName(then))
            } else {
                context.getString(R.string.trip_then_change_at, rideName(then), departs) + missed
            }
        } ?: context.getString(CopyR.string.trip_then_done)
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
        lastProgress.clear()
        manager.cancel(ASK_ID)
        manager.cancel(ALERT_ID)
        manager.cancel(REROUTE_ID)
        reroute = null
        alighted = null
    }

    /**
     * "Rekaman Detail": the minute after a trip, still recording what the rider does getting off.
     * The foreground service's own, once the trip's is gone; quiet, as the trip's.
     */
    fun recording(): Notification {
        ensureChannels()
        return NotificationCompat.Builder(context, NotificationChannels.TRIP_PROGRESS)
            .setSmallIcon(R.drawable.ic_stat_trip)
            .setContentTitle(context.getString(R.string.trip_recording_tail))
            .setOngoing(true)
            .setSilent(true)
            .setShowWhen(false)
            .build()
    }

    /** The trip's ongoing notification, gone after the service moved onto [recording]'s. */
    fun cancelProgress() {
        manager.cancel(PROGRESS_ID)
        lastProgress.clear()
    }

    /** [recording]'s, gone once a new trip's notification has taken the service over. */
    fun cancelRecording() = manager.cancel(RECORDING_ID)

    private fun alertBuilder(
        title: String,
        text: String,
        icon: Int = R.drawable.ic_stat_trip,
        channel: String = NotificationChannels.TRIP_ALERTS,
    ) =
        NotificationCompat.Builder(context, channel)
            .also { ensureChannels() }
            .setSmallIcon(icon)
            .setContentTitle(title)
            .setContentText(text)
            .setStyle(NotificationCompat.BigTextStyle().bigText(text))
            .setContentIntent(openTrip)
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setVibrate(NotificationChannels.ALERT_VIBRATION)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)

    /**
     * One segment per ride in its line's colour, a point at each change, and the tracker solid when a
     * fix places the rider and hollow when it is the timetable's guess.
     */
    private fun progressStyle(content: ProgressContent): NotificationCompat.ProgressStyle {
        val style = NotificationCompat.ProgressStyle()
            .setStyledByProgress(true)
            .setProgressSegments(content.segments.map { (length, color) -> NotificationCompat.ProgressStyle.Segment(length).setColor(color) })
            .setProgress(content.progress)
            .setProgressTrackerIcon(IconCompat.createWithResource(context, content.tracker))
        var at = 0
        content.segments.dropLast(1).forEach { (length, _) ->
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

    private fun action(name: String): PendingIntent = actions.getOrPut(name) { TripReceiver.pendingIntent(context, name) }

    private fun ensureChannels() {
        if (channelsReady) return
        NotificationChannels.ensure(context)
        channelsReady = true
    }

    @SuppressLint("MissingPermission") // Checked just above; without it nothing is posted.
    private fun notify(id: Int, notification: Notification) {
        if (NotificationChannels.allowed(context)) manager.notify(id, notification)
    }

    companion object {

        const val PROGRESS_ID = 41
        private const val ALERT_ID = 42
        private const val ASK_ID = 43
        private const val REROUTE_ID = 44

        /** [TripWaker]'s: here with the rest, as cancelling another's id would take the alarm's "Udah bangun" with it. */
        const val ALARM_ID = 45

        /** [recording]'s. */
        const val RECORDING_ID = 46

        /** How long after "Turun di sini" news of a missed change goes into it instead of its own. */
        private val JUST_OFF: Duration = Duration.ofMinutes(3)

        /** Segment lengths are in stops; this keeps a one-stop ride a visible share of the bar. */
        private const val SEGMENT_UNIT = 100

        private val FALLBACK_LINE = 0xFF64748B.toInt()
        private val BRAND = CommuteColors.primaryLight.toArgb()
        private val CHANGE_POINT = 0xFF0F172A.toInt()
    }
}
