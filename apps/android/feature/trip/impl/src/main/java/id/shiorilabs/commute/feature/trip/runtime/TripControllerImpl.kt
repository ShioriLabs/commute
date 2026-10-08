package id.shiorilabs.commute.feature.trip.runtime

import id.shiorilabs.commute.core.datastore.LocationPreferencesRepository
import id.shiorilabs.commute.core.location.Fix
import id.shiorilabs.commute.core.location.LocationClient
import id.shiorilabs.commute.core.navigation.Route
import id.shiorilabs.commute.core.query.di.ApplicationScope
import id.shiorilabs.commute.core.trip.AlertKind
import id.shiorilabs.commute.core.trip.FinishReason
import id.shiorilabs.commute.core.trip.InstantSerializer
import id.shiorilabs.commute.core.trip.PositionSource
import id.shiorilabs.commute.core.trip.RiderAction
import id.shiorilabs.commute.core.trip.TripEffect
import id.shiorilabs.commute.core.trip.TripEngine
import id.shiorilabs.commute.core.trip.TripLeg
import id.shiorilabs.commute.core.trip.TripPhase
import id.shiorilabs.commute.core.trip.TripState
import id.shiorilabs.commute.core.trip.expectedAlightingAt
import id.shiorilabs.commute.core.trip.nextRideReadyAt
import id.shiorilabs.commute.core.trip.walkEndsAt
import id.shiorilabs.commute.core.trip.TripEvent
import id.shiorilabs.commute.core.trip.TripPlan
import id.shiorilabs.commute.core.trip.TripStep
import id.shiorilabs.commute.feature.trip.ActiveTrip
import id.shiorilabs.commute.feature.trip.ReplacedPlan
import id.shiorilabs.commute.feature.trip.TripController
import id.shiorilabs.commute.feature.trip.TripReminder
import id.shiorilabs.commute.feature.trip.TripReplanner
import kotlinx.coroutines.CompletableJob
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.drop
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.Serializable
import java.time.Clock
import java.time.Duration
import java.time.Instant
import kotlin.math.floor
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Runs the trip: every event goes through the engine one at a time, and its effects are carried out
 * here, whether the event came from the location service, the clock, an alarm that woke a killed
 * process, or a tap. So a trip without location (no service) works the same way, only with fewer
 * events.
 */
@Singleton
class TripControllerImpl @Inject constructor(
    private val store: TripStore,
    private val runtime: TripRuntime,
    private val locator: StopLocator,
    private val location: LocationClient,
    private val locationPreferences: LocationPreferencesRepository,
    private val replanner: TripReplanner,
    private val log: TripLog,
    private val clock: Clock,
    @param:ApplicationScope private val scope: CoroutineScope,
) : TripController {

    private val mutex = Mutex()
    private val _active = MutableStateFlow<ActiveTrip?>(null)
    override val active: StateFlow<ActiveTrip?> = _active.asStateFlow()

    private val _finished = MutableStateFlow<FinishedTrip?>(null)

    /**
     * The trip that last ended and how, until another starts or [FINISHED_KEPT] has passed: the
     * trip page's last word on it, stored so it's there after the process has gone too.
     */
    val finished: StateFlow<FinishedTrip?> = _finished.asStateFlow()

    private var timer: Job? = null

    /** The ride, by leg and departure, last re-planned for, so a missed train is asked about once. */
    private var replannedFor: String? = null

    /**
     * A trip stored by an earlier process carries on, from the clock until a fix confirms it.
     * Made before the restore is launched: on a thread pool the restore can be done, and what it
     * started already waiting on this, before the constructor gets past the launch.
     */
    private val restored: CompletableJob = Job()

    init {
        scope.launch {
            try {
                mutex.withLock {
                    _finished.value = store.readFinished()?.takeIf { clock.instant().isBefore(it.at.plus(FINISHED_KEPT)) }
                    val trip = store.read() ?: return@withLock
                    log.event("restored", mapOf("journey" to trip.origin.journeyKey, "phase" to trip.state.phase))
                    _active.value = trip
                    apply(trip, TripEngine.step(trip.plan, trip.state, TripEvent.Resumed(clock.instant())))
                }
            } finally {
                restored.complete()
            }
            resumeTracking()
        }
    }

    /**
     * "Posisi akurat saat OTW" switched in Pengaturan → Lokasi during a trip: off, the trip carries
     * on by the clock; back on, it looks for the rider again.
     */
    private val followsSettings: Job = scope.launch {
        locationPreferences.use.map { it.allowsTripFixes }.distinctUntilChanged().drop(1).collect { allowed ->
            if (allowed) {
                resumeTracking()
            } else {
                runtime.stopTracking()
                trackingLost()
            }
        }
    }

    /** Fixes along the way: the system's permission and the rider's own setting both allow them. */
    private suspend fun mayTrack(): Boolean = location.hasPermission() && locationPreferences.use.first().allowsTripFixes

    override fun start(plan: TripPlan, origin: Route.Trip) {
        scope.launch {
            restored.join()
            val placed = locator.place(plan)
            val hasLocation = mayTrack()
            mutex.withLock {
                if (_active.value != null) runtime.finish()
                _finished.value = null
                store.clearFinished()
                val step = TripEngine.start(placed, clock.instant(), hasLocation)
                log.event("started", mapOf("journey" to origin.journeyKey, "location" to hasLocation))
                apply(ActiveTrip(placed, step.state, origin), step)
            }
            if (hasLocation && !runtime.startTracking()) send(TripEvent.LocationAvailability(false, clock.instant()))
        }
    }

    override fun setReminder(reminder: TripReminder) {
        scope.launch {
            restored.join()
            mutex.withLock {
                val trip = _active.value ?: return@withLock
                if (trip.reminder == reminder) return@withLock
                log.event("reminder", mapOf("kind" to reminder))
                val next = trip.copy(reminder = reminder)
                _active.value = next
                store.write(next)
                if (reminder != TripReminder.WAKE) runtime.stopWakingRider()
            }
        }
    }

    override fun riderSaid(action: RiderAction) {
        scope.launch { say(action) }
    }

    override fun stop() {
        scope.launch { say(RiderAction.STOP) }
    }

    /**
     * From the foreground (the live screen, the trip page): starts the location service again if it
     * isn't running, as after a restart from the background, where the system wouldn't allow it.
     */
    fun resumeTracking() {
        scope.launch {
            restored.join()
            if (_active.value == null || !mayTrack()) return@launch
            if (runtime.startTracking()) send(TripEvent.LocationAvailability(true, clock.instant()))
        }
    }

    suspend fun say(action: RiderAction) {
        // Off the train, or done with it: whoever was being woken is up.
        if (action == RiderAction.ALIGHTED || action == RiderAction.STOP) runtime.stopWakingRider()
        send(TripEvent.RiderSaid(action, clock.instant()))
    }

    suspend fun tick() = send(TripEvent.Tick(clock.instant()))

    suspend fun onFix(fix: Fix) = send(TripEvent.Fix(fix.point, fix.accuracyM, fix.at, fix.speedMps))

    /** The service couldn't run (refused, or location went away): carry on by the clock. */
    suspend fun trackingLost() = send(TripEvent.LocationAvailability(false, clock.instant()))

    private suspend fun send(event: TripEvent) {
        restored.join()
        mutex.withLock {
            val before = _active.value ?: return
            val (trip, step) = boardedEarlier(before, event, TripEngine.step(before.plan, before.state, event))
            logStep(event, before.state, step.state)
            apply(trip, step)
        }
    }

    /**
     * Boarded a ride that was swapped for a later one: well before the later one could have left
     * (seen that far ahead of it, or "Udah naik" before it was due), the rider is on the one it
     * replaced, which ran late. Back to that plan then, the lateness measured against it. Either way
     * the swap is settled.
     */
    private fun boardedEarlier(trip: ActiveTrip, event: TripEvent, step: TripStep): Pair<ActiveTrip, TripStep> {
        val replaced = trip.replaced ?: return trip to step
        val leg = replaced.legIndex
        val waiting = trip.state.legIndex == leg && trip.state.phase == TripPhase.WAITING_TO_BOARD
        if (trip.state.legIndex > leg) return trip.copy(replaced = null) to step
        if (!waiting || (step.state.legIndex == leg && step.state.phase == TripPhase.WAITING_TO_BOARD)) return trip to step
        val untilDue = trip.plan.ride(leg).departureAt?.let { Duration.between(event.at, it).seconds } ?: 0
        if (maxOf(-step.state.clockOffsetS, untilDue) < EARLIER_TRAIN.seconds) return trip.copy(replaced = null) to step
        log.event("earlier", mapOf("leg" to leg, "departs" to replaced.plan.ride(leg).departureAt))
        return trip.copy(plan = replaced.plan, replaced = null) to TripEngine.step(replaced.plan, trip.state, event)
    }

    /**
     * What came in and where it left the trip: every fix and tap, and the clock's ticks only when
     * they moved it on (another stop, phase or leg, or how it's known), so a ride reads stop by stop.
     */
    private fun logStep(event: TripEvent, before: TripState, after: TripState) {
        val (name, facts) = when (event) {
            is TripEvent.Fix -> "fix" to mapOf("lat" to event.point.latitude, "lon" to event.point.longitude, "acc" to event.accuracyM, "speed" to event.speedMps)
            is TripEvent.RiderSaid -> "rider" to mapOf("action" to event.action)
            is TripEvent.LocationAvailability -> "location" to mapOf("available" to event.available)
            is TripEvent.Resumed -> "resumed" to emptyMap()
            is TripEvent.Tick -> {
                val moved = before.legIndex != after.legIndex || before.phase != after.phase ||
                    before.source != after.source || floor(before.position) != floor(after.position)
                if (!moved) return
                "tick" to emptyMap()
            }
        }
        log.event(name, facts + stateFacts(after))
    }

    /**
     * A rider's own note of what the train is doing ([kind]), with what the board showed then
     * ([board]): logged beside the trip's reckoning for a field test to set them side by side.
     * Changes nothing about the trip.
     */
    fun mark(kind: String, board: Map<String, Any?>) {
        scope.launch {
            mutex.withLock {
                val state = _active.value?.state
                log.event("mark", mapOf("kind" to kind) + board + (state?.let(::stateFacts) ?: emptyMap()))
            }
        }
    }

    /** Where a step left the trip, as the log keeps it. */
    private fun stateFacts(state: TripState): Map<String, Any?> = mapOf(
        "leg" to state.legIndex,
        "phase" to state.phase,
        "pos" to Math.round(state.position * 1000) / 1000.0,
        "confirmed" to Math.round(state.confirmedPosition * 1000) / 1000.0,
        "src" to state.source,
        "offsetS" to state.clockOffsetS,
        "walking" to (state.walkingSince != null),
    )

    /** Carries out one step. Called with the lock held. */
    private fun apply(trip: ActiveTrip, step: TripStep) {
        val next = trip.copy(state = step.state)
        val alerts = step.effects.filterIsInstance<TripEffect.Alert>()

        val finished = step.effects.filterIsInstance<TripEffect.Finished>().firstOrNull()
        if (finished != null) {
            log.event("finished", mapOf("journey" to trip.origin.journeyKey, "reason" to finished.reason))
            // A trip that ran out its time catches up in one step, alerts and all, hours late:
            // those would only be noise now.
            if (finished.reason != FinishReason.TIMED_OUT) alerts.forEach { runtime.alert(next, it) }
            // At the destination an alarm already ringing rings on until the rider says they're up.
            if (finished.reason != FinishReason.ARRIVED) runtime.stopWakingRider()
            timer?.cancel()
            runtime.cancelWake()
            runtime.stopTracking()
            runtime.finish()
            store.clear()
            FinishedTrip(next, finished.reason, clock.instant()).also {
                _finished.value = it
                store.writeFinished(it)
            }
            _active.value = null
            return
        }

        _active.value = next
        store.write(next)
        alerts.forEach {
            log.event("alert", mapOf("kind" to it.kind, "leg" to it.legIndex, "estimated" to it.estimated))
            runtime.alert(next, it)
        }
        // "Tambah Pengingat": the first word of getting off (a stop out, or at it if that came
        // first) brings the reminder too.
        if (next.reminder != TripReminder.NONE) {
            alerts.firstOrNull { it.kind == AlertKind.PREPARE || it.kind == AlertKind.ALIGHT }
                ?.let { runtime.remindRider(next, it.legIndex) }
        }
        if (TripEffect.AskStillOnRoute in step.effects) runtime.askStillOnRoute(next)
        runtime.showProgress(next)
        schedule(step.nextWakeAt)
        replanIfMissed(next)
    }

    /**
     * The ride being waited for leaves before the rider can be on it (still walking to it, or not
     * aboard a minute after it was due): asks for the way on from its station, and takes it in
     * place of the rest of the plan, telling the rider unless they're [onPlatform]. The plan it
     * replaces is kept for [boardedEarlier]. Called with the lock held; the asking runs outside it.
     *
     * Or, ahead of that, the next ride will have left by the time the late one aboard gets in and
     * the rider walks across: swapped from aboard as soon as a fix shows it, so the board never
     * shows a change already lost. Told only within [EARLY_REPLAN] of getting in ([tellSwap]), and
     * taken back untold if the train makes up the time ([takeBack]). Only on lateness a fix saw on
     * the move; a late "Udah naik" tap would read as a late train.
     */
    private fun replanIfMissed(trip: ActiveTrip) {
        val state = trip.state
        val now = clock.instant()
        val (legIndex, readyAt) = when (state.phase) {
            TripPhase.WAITING_TO_BOARD -> state.legIndex to maxOf(now, state.walkEndsAt(trip.plan) ?: now)
            TripPhase.RIDING -> {
                if (state.source != PositionSource.CONFIRMED || state.confirmedPosition <= 0.0) return
                state.nextRideReadyAt(trip.plan) ?: return
            }
            else -> return
        }
        if (takeBack(trip, legIndex, readyAt)) return
        tellSwap(trip, legIndex, now)
        val ride = trip.plan.ride(legIndex)
        val departs = ride.departureAt ?: return
        if (!readyAt.isAfter(departs.plus(CATCH_GRACE))) return
        val key = "$legIndex@$departs"
        if (key == replannedFor) return
        replannedFor = key
        scope.launch {
            val onward = replanner.replan(ride.stops.first().id, trip.plan.destination.id, readyAt, ride.line)
                ?.let { locator.place(it) }
                ?.takeIf { it.legs.firstOrNull() is TripLeg.Ride }
            if (onward == null) {
                log.event("missed", mapOf("leg" to legIndex, "departs" to departs, "ready" to readyAt, "onward" to null))
                // Offline, say: ask again once it's had a while, on whatever step comes next.
                delay(REPLAN_RETRY.toMillis())
                if (replannedFor == key) replannedFor = null
                return@launch
            }
            mutex.withLock {
                val current = _active.value ?: return@withLock
                // Moved on meanwhile (boarded it after all, or already re-planned): leave it be.
                val boarded = current.state.legIndex > legIndex ||
                    (current.state.legIndex == legIndex && current.state.phase != TripPhase.WAITING_TO_BOARD)
                if (current.plan != trip.plan || boarded) return@withLock
                val plan = TripPlan(current.plan.legs.take(legIndex) + onward.legs)
                val told = tells(current.plan, state, now)
                val aboard = state.phase == TripPhase.RIDING
                // The first train lost and not yet told of, while riding on: told of when it's near.
                val untold = (current.replaced?.untold ?: departs).takeIf { aboard && !told }
                log.event(
                    "missed",
                    mapOf(
                        "leg" to legIndex,
                        "departs" to departs,
                        "ready" to readyAt,
                        "onward" to plan.ride(legIndex).departureAt,
                        "aboard" to aboard,
                        "told" to told,
                    ),
                )
                // The plan just swapped out, not the first: swapped again and again on a platform,
                // a rider boarding early is on the train before this one, not the one at the start.
                val replanned = current.copy(plan = plan, replaced = ReplacedPlan(current.plan, legIndex, untold))
                if (told) runtime.rerouted(replanned, legIndex, current.replaced?.untold ?: departs)
                apply(replanned, TripEngine.step(plan, current.state, TripEvent.Tick(clock.instant())))
            }
        }
    }

    /**
     * Seen at the station of the ride being waited for, and not walking to it: whatever comes next
     * is what they'll take, the train being late, gone, or let go full. A swap is no news to them;
     * the board shows it, and [boardedEarlier] puts it back if the late one turns up.
     */
    private fun onPlatform(state: TripState): Boolean =
        state.phase == TripPhase.WAITING_TO_BOARD && state.walkingSince == null &&
            state.source == PositionSource.CONFIRMED && state.sightedPosition == 0.0

    /**
     * Whether a swap is news to tell the rider now: waiting, unless [onPlatform]; aboard, within
     * [EARLY_REPLAN] of getting in, near enough that the lateness won't be made up.
     */
    private fun tells(plan: TripPlan, state: TripState, now: Instant): Boolean = when (state.phase) {
        TripPhase.WAITING_TO_BOARD -> !onPlatform(state)
        TripPhase.RIDING -> state.expectedAlightingAt(plan)?.isAfter(now.plus(EARLY_REPLAN)) != true
        else -> false
    }

    /**
     * Swapped untold from aboard, and the train has made up the time: ride [legIndex] can be caught
     * after all ([readyAt] no later than it leaves), so it's back, without asking. A swap the rider
     * was told of stays; [boardedEarlier] still takes it back if they make the train regardless.
     * Called with the lock held.
     */
    private fun takeBack(trip: ActiveTrip, legIndex: Int, readyAt: Instant): Boolean {
        val replaced = trip.replaced ?: return false
        if (trip.state.phase != TripPhase.RIDING || replaced.legIndex != legIndex || replaced.untold == null) return false
        val departs = replaced.plan.ride(legIndex).departureAt ?: return false
        if (readyAt.isAfter(departs)) return false
        log.event("caught", mapOf("leg" to legIndex, "departs" to departs, "ready" to readyAt))
        // Missed again later, it's asked about again.
        replannedFor = null
        apply(trip.copy(plan = replaced.plan, replaced = null), TripEngine.step(replaced.plan, trip.state, TripEvent.Tick(clock.instant())))
        return true
    }

    /** A swap made untold from aboard, now near enough to [tells]: told, of the first train lost. */
    private fun tellSwap(trip: ActiveTrip, legIndex: Int, now: Instant) {
        val replaced = trip.replaced?.takeIf { it.legIndex == legIndex } ?: return
        val missed = replaced.untold ?: return
        if (!tells(trip.plan, trip.state, now)) return
        log.event("told", mapOf("leg" to legIndex, "departs" to missed, "onward" to trip.plan.ride(legIndex).departureAt))
        val told = trip.copy(replaced = replaced.copy(untold = null))
        _active.value = told
        store.write(told)
        runtime.rerouted(told, legIndex, missed)
    }

    /**
     * Ticks at [at] twice over: a timer for while the process is awake, and an alarm for when it
     * dozes or dies. Whichever is second finds nothing new; a tick is idempotent.
     */
    private fun schedule(at: Instant?) {
        timer?.cancel()
        if (at == null) {
            runtime.cancelWake()
            return
        }
        runtime.wakeAt(at)
        timer = scope.launch {
            delay(Duration.between(clock.instant(), at).toMillis().coerceAtLeast(0))
            // In its own coroutine: the step it causes reschedules, cancelling this timer.
            scope.launch { tick() }
        }
    }

    private companion object {

        /** A train a minute late is still worth running for; past that, look for the next. */
        val CATCH_GRACE: Duration = Duration.ofMinutes(1)

        /**
         * How soon before the late ride gets in a missed change is told from aboard it: near enough
         * that its lateness won't be made up, early enough to sit with the news.
         */
        val EARLY_REPLAN: Duration = Duration.ofMinutes(10)

        /** How long before asking again when a re-plan found nothing. */
        val REPLAN_RETRY: Duration = Duration.ofMinutes(2)

        /**
         * Boarded this far ahead of the train a ride was swapped for, it's the one before. Trains
         * don't leave two minutes early; tonight's were five and six ahead.
         */
        val EARLIER_TRAIN: Duration = Duration.ofMinutes(2)
    }
}

/** A trip that has ended: as it stood at the end, why it ended, and when. */
@Serializable
data class FinishedTrip(
    val trip: ActiveTrip,
    val reason: FinishReason,
    @Serializable(with = InstantSerializer::class)
    val at: Instant,
)

/** How long a finished trip's summary stays: about the rest of a day out. */
private val FINISHED_KEPT: Duration = Duration.ofHours(6)
