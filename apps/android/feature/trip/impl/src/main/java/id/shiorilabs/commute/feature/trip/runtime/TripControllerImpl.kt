package id.shiorilabs.commute.feature.trip.runtime

import android.util.Log
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
import id.shiorilabs.commute.core.trip.TripEvent
import id.shiorilabs.commute.core.trip.TripPlan
import id.shiorilabs.commute.core.trip.TripStep
import id.shiorilabs.commute.feature.trip.ActiveTrip
import id.shiorilabs.commute.feature.trip.TripController
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

    /** A trip stored by an earlier process carries on, from the clock until a fix confirms it. */
    private val restored: Job = scope.launch {
        mutex.withLock {
            _finished.value = store.readFinished()?.takeIf { clock.instant().isBefore(it.at.plus(FINISHED_KEPT)) }
            val trip = store.read() ?: return@withLock
            Log.i(TAG, "restored ${trip.origin.journeyKey} at ${trip.state.phase}")
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
                Log.i(TAG, "started ${origin.journeyKey}, location ${if (hasLocation) "on" else "off"}")
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
            apply(trip, TripEngine.step(trip.plan, trip.state, event))
        }
    }

    /** Carries out one step. Called with the lock held. */
    private fun apply(trip: ActiveTrip, step: TripStep) {
        val next = trip.copy(state = step.state)
        val alerts = step.effects.filterIsInstance<TripEffect.Alert>()

        val finished = step.effects.filterIsInstance<TripEffect.Finished>().firstOrNull()
        if (finished != null) {
            Log.i(TAG, "finished ${trip.origin.journeyKey}: ${finished.reason}")
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
            Log.i(TAG, "alert ${it.kind} on leg ${it.legIndex}${if (it.estimated) ", estimated" else ""}")
            runtime.alert(next, it)
        }
        if (TripEffect.AskStillOnRoute in step.effects) runtime.askStillOnRoute(next)
        runtime.showProgress(next)
        schedule(step.nextWakeAt)
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

        /** `adb logcat -s CommuteTrip`: what a field test needs to tell why a trip did what it did. */
        const val TAG = "CommuteTrip"
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
