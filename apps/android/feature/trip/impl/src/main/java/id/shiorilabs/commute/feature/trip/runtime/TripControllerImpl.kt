package id.shiorilabs.commute.feature.trip.runtime

import id.shiorilabs.commute.core.datastore.LocationPreferencesRepository
import id.shiorilabs.commute.core.location.Fix
import id.shiorilabs.commute.core.location.LocationClient
import id.shiorilabs.commute.core.navigation.Route
import id.shiorilabs.commute.core.query.di.ApplicationScope
import id.shiorilabs.commute.core.trip.FinishReason
import id.shiorilabs.commute.core.trip.InstantSerializer
import id.shiorilabs.commute.core.trip.RiderAction
import id.shiorilabs.commute.core.trip.TripEffect
import id.shiorilabs.commute.core.trip.TripEngine
import id.shiorilabs.commute.core.trip.TripLeg
import id.shiorilabs.commute.core.trip.TripPhase
import id.shiorilabs.commute.core.trip.TripState
import id.shiorilabs.commute.core.trip.walkEndsAt
import id.shiorilabs.commute.core.trip.TripEvent
import id.shiorilabs.commute.core.trip.TripPlan
import id.shiorilabs.commute.core.trip.TripStep
import id.shiorilabs.commute.feature.trip.ActiveTrip
import id.shiorilabs.commute.feature.trip.TripController
import id.shiorilabs.commute.feature.trip.TripReplanner
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

    /** A trip stored by an earlier process carries on, from the clock until a fix confirms it. */
    private val restored: Job = scope.launch {
        mutex.withLock {
            _finished.value = store.readFinished()?.takeIf { clock.instant().isBefore(it.at.plus(FINISHED_KEPT)) }
            val trip = store.read() ?: return@withLock
            log.event("restored", mapOf("journey" to trip.origin.journeyKey, "phase" to trip.state.phase))
            _active.value = trip
            apply(trip, TripEngine.step(trip.plan, trip.state, TripEvent.Resumed(clock.instant())))
        }
        resumeTracking()
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

    suspend fun say(action: RiderAction) = send(TripEvent.RiderSaid(action, clock.instant()))

    suspend fun tick() = send(TripEvent.Tick(clock.instant()))

    suspend fun onFix(fix: Fix) = send(TripEvent.Fix(fix.point, fix.accuracyM, fix.at))

    /** The service couldn't run (refused, or location went away): carry on by the clock. */
    suspend fun trackingLost() = send(TripEvent.LocationAvailability(false, clock.instant()))

    private suspend fun send(event: TripEvent) {
        restored.join()
        mutex.withLock {
            val trip = _active.value ?: return
            val step = TripEngine.step(trip.plan, trip.state, event)
            logStep(event, trip.state, step.state)
            apply(trip, step)
        }
    }

    /**
     * What came in and where it left the trip: every fix and tap, and the clock's ticks only when
     * they moved it on (another stop, phase or leg, or how it's known), so a ride reads stop by stop.
     */
    private fun logStep(event: TripEvent, before: TripState, after: TripState) {
        val (name, facts) = when (event) {
            is TripEvent.Fix -> "fix" to mapOf("lat" to event.point.latitude, "lon" to event.point.longitude, "acc" to event.accuracyM)
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
        if (TripEffect.AskStillOnRoute in step.effects) runtime.askStillOnRoute(next)
        runtime.showProgress(next)
        schedule(step.nextWakeAt)
        replanIfMissed(next)
    }

    /**
     * The ride being waited for leaves before the rider can be on it (still walking to it, or not
     * aboard a minute after it was due): asks for the way on from its station, and takes it in
     * place of the rest of the plan. Called with the lock held; the asking runs outside it.
     */
    private fun replanIfMissed(trip: ActiveTrip) {
        val state = trip.state
        if (state.phase != TripPhase.WAITING_TO_BOARD) return
        val ride = trip.plan.ride(state.legIndex)
        val departs = ride.departureAt ?: return
        val now = clock.instant()
        val readyAt = maxOf(now, state.walkEndsAt(trip.plan) ?: now)
        if (!readyAt.isAfter(departs.plus(CATCH_GRACE))) return
        val key = "${state.legIndex}@$departs"
        if (key == replannedFor) return
        replannedFor = key
        scope.launch {
            val onward = replanner.replan(ride.stops.first().id, trip.plan.destination.id, readyAt, ride.line)
                ?.let { locator.place(it) }
                ?.takeIf { it.legs.firstOrNull() is TripLeg.Ride }
            if (onward == null) {
                log.event("missed", mapOf("leg" to state.legIndex, "departs" to departs, "onward" to null))
                // Offline, say: ask again once it's had a while, on whatever step comes next.
                delay(REPLAN_RETRY.toMillis())
                if (replannedFor == key) replannedFor = null
                return@launch
            }
            mutex.withLock {
                val current = _active.value ?: return@withLock
                // Moved on meanwhile (boarded after all, or already re-planned): leave it be.
                if (current.plan != trip.plan || current.state.legIndex != state.legIndex ||
                    current.state.phase != TripPhase.WAITING_TO_BOARD
                ) {
                    return@withLock
                }
                val plan = TripPlan(current.plan.legs.take(state.legIndex) + onward.legs)
                log.event("missed", mapOf("leg" to state.legIndex, "departs" to departs, "onward" to plan.ride(state.legIndex).departureAt))
                val replanned = current.copy(plan = plan)
                runtime.rerouted(replanned, departs)
                apply(replanned, TripEngine.step(plan, current.state, TripEvent.Tick(clock.instant())))
            }
        }
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

        /** How long before asking again when a re-plan found nothing. */
        val REPLAN_RETRY: Duration = Duration.ofMinutes(2)
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
