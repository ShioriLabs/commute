package id.shiorilabs.commute.feature.trip.runtime

import id.shiorilabs.commute.core.datastore.LocationPreferencesRepository
import id.shiorilabs.commute.core.location.Fix
import id.shiorilabs.commute.core.location.LocationClient
import id.shiorilabs.commute.core.navigation.Route
import id.shiorilabs.commute.core.query.di.ApplicationScope
import id.shiorilabs.commute.core.trip.AlertKind
import id.shiorilabs.commute.core.trip.CATCH_GRACE
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
import id.shiorilabs.commute.core.trip.scheduledAtStop
import id.shiorilabs.commute.core.trip.seenAt
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
import kotlinx.coroutines.withTimeoutOrNull
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

    /** The re-plan being asked, for an alarm that woke the process to wait on ([awaitReplan]). */
    private var replanJob: Job? = null

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
                    val resumed = TripEvent.Resumed(clock.instant())
                    val step = TripEngine.step(trip.plan, trip.state, resumed)
                    logStep(resumed, trip.state, step.state)
                    apply(trip, step)
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
            if (hasLocation && !startTracking("start")) send(TripEvent.LocationAvailability(false, clock.instant()))
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
            if (startTracking("resume")) send(TripEvent.LocationAvailability(true, clock.instant()))
        }
    }

    /** Asks the service to follow the rider, and logs it when the system won't allow it ([by] says from where). */
    private fun startTracking(by: String): Boolean {
        val started = runtime.startTracking()
        if (!started) log.event("tracking", mapOf("started" to false, "by" to by))
        return started
    }

    /**
     * For an alarm that woke the process: returns once the re-plan the tick started has been
     * answered and applied, or after [timeout]. A receiver that finished first would leave the
     * process free to be frozen with the request in flight, as at 10.18 on 19 Oct.
     */
    suspend fun awaitReplan(timeout: Duration) {
        restored.join()
        withTimeoutOrNull(timeout.toMillis()) { replanJob?.join() }
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
            val (boarded, stepped) = boardedEarlier(before, event, TripEngine.step(before.plan, before.state, event))
            val (left, leftStep) = leftTooEarly(boarded, event, stepped)
            val (trip, step) = boardedLater(before, left, event, leftStep)
            logStep(event, before.state, step.state)
            apply(trip, step)
        }
    }

    /**
     * Boarded a ride that was swapped for a later one: well before the later one could have left
     * (seen that far ahead of it, or "Udah naik" before it was due), the rider is on the one it
     * replaced, which ran late. Back to that plan then, the lateness measured against it. Boarded
     * about when the later one was due, it could be either, the earlier one late enough to leave
     * with the later one's time: that's left to [leftTooEarly].
     */
    private fun boardedEarlier(trip: ActiveTrip, event: TripEvent, step: TripStep): Pair<ActiveTrip, TripStep> {
        val replaced = trip.replaced ?: return trip to step
        val leg = replaced.legIndex
        val waiting = trip.state.legIndex == leg && trip.state.phase == TripPhase.WAITING_TO_BOARD
        if (trip.state.legIndex > leg) return trip.copy(replaced = null) to step
        if (!waiting || (step.state.legIndex == leg && step.state.phase == TripPhase.WAITING_TO_BOARD)) return trip to step
        val untilDue = trip.plan.ride(leg).departureAt?.let { Duration.between(event.at, it).seconds } ?: 0
        if (maxOf(-step.state.clockOffsetS, untilDue) < EARLIER_TRAIN.seconds) {
            val aboard = step.state.legIndex == leg && step.state.phase == TripPhase.RIDING
            val either = replaced.takeIf { aboard && sameRide(it.plan, trip.plan, leg) }
            return trip.copy(replaced = null, mightBeOn = either) to step
        }
        log.event("earlier", mapOf("leg" to leg, "departs" to replaced.plan.ride(leg).departureAt))
        runtime.rerouteTakenBack(leg)
        return trip.copy(plan = replaced.plan, replaced = null) to TripEngine.step(replaced.plan, trip.state, event)
    }

    /**
     * Aboard a train that could be either of two ([ActiveTrip.mightBeOn]): one leaving a station on
     * the way [LEFT_EARLY] or more before the plan's train is due to is not that train, when the
     * earlier one it was swapped from could have. A train doesn't leave early; it waits out a padded
     * timetable. Sudirman's on 16 Oct was the 18.57 five and a half minutes late, taken for the 19.02,
     * whose run is padded ten minutes to Manggarai: it left there 19.08.52, four minutes before the
     * 19.02 was due to, the board pinned early for the whole ride.
     */
    private fun leftTooEarly(trip: ActiveTrip, event: TripEvent, step: TripStep): Pair<ActiveTrip, TripStep> {
        val earlier = trip.mightBeOn ?: return trip to step
        val leg = earlier.legIndex
        val state = step.state
        if (state.legIndex != leg || state.phase != TripPhase.RIDING) return trip.copy(mightBeOn = null) to step
        val ride = trip.plan.ride(leg)
        val left = (1 until ride.lastIndex).lastOrNull { it < state.confirmedPosition && state.seenAt(leg, it) != null }
            ?: return trip to step
        val leftAt = state.seenAt(leg, left)!!
        val ahead = trip.plan.scheduledAtStop(leg, left)?.let { Duration.between(leftAt, it) } ?: return trip to step
        val earlierAhead = earlier.plan.scheduledAtStop(leg, left)?.let { Duration.between(leftAt, it) } ?: return trip to step
        if (ahead < LEFT_EARLY || earlierAhead >= LEFT_EARLY) return trip to step
        log.event("earlier", mapOf("leg" to leg, "departs" to earlier.plan.ride(leg).departureAt, "left" to left, "aheadS" to ahead.seconds))
        runtime.rerouteTakenBack(leg)
        return trip.copy(plan = earlier.plan, mightBeOn = null) to TripEngine.step(earlier.plan, trip.state, event)
    }

    /**
     * Boarded well after the planned train, with a later one due about then: the later one is the
     * train they're on, not the planned one running that late. Boarding at 10.21.42 for the 10.17 with
     * the 10.21 behind it, the board showed the 10.17 282 s late. The leg moves onto that train (its
     * times shifted, offline: the stops and the line are the same) and the lateness is measured
     * against it. Later rides are left to [replanIfMissed] to find missed or not.
     *
     * The nearer train in time wins, the planned one on a tie; a later train counts only when due no
     * more than [EARLIER_TRAIN] after boarding, and the planned one only when over [CATCH_GRACE] gone.
     * A swap already made ([ActiveTrip.replaced]) is the plan's train, and [boardedEarlier] its business.
     */
    private fun boardedLater(before: ActiveTrip, trip: ActiveTrip, event: TripEvent, step: TripStep): Pair<ActiveTrip, TripStep> {
        val leg = before.state.legIndex
        val state = step.state
        if (before.state.phase != TripPhase.WAITING_TO_BOARD || state.phase != TripPhase.RIDING || state.legIndex != leg) return trip to step
        if (trip.plan != before.plan) return trip to step
        val ride = trip.plan.ride(leg)
        val planned = ride.departureAt ?: return trip to step
        val boardedAt = event.at
        if (!boardedAt.isAfter(planned.plus(CATCH_GRACE))) return trip to step
        val took = ride.nextDepartures
            .filter { !it.isAfter(boardedAt.plus(EARLIER_TRAIN)) }
            .minByOrNull { Math.abs(Duration.between(it, boardedAt).seconds) }
            ?: return trip to step
        if (Math.abs(Duration.between(took, boardedAt).seconds) >= Math.abs(Duration.between(planned, boardedAt).seconds)) return trip to step

        val delta = Duration.between(planned, took)
        val shifted = ride.copy(
            departureAt = took,
            arrivalAt = ride.arrivalAt?.plus(delta),
            stops = ride.stops.map { it.copy(scheduledAt = it.scheduledAt?.plus(delta)) },
            // Which run it is isn't known from here, only when it left.
            tripId = null,
            nextDepartures = ride.nextDepartures.filter { it.isAfter(took) },
        )
        val plan = TripPlan(trip.plan.legs.toMutableList().also { it[leg] = shifted })
        log.event("later", mapOf("leg" to leg, "planned" to planned, "took" to took, "boarded" to boardedAt))
        val offset = (state.clockOffsetS - delta.seconds).coerceAtLeast(MAX_EARLY_S)
        val moved = trip.copy(plan = plan, replaced = null, mightBeOn = null)
        return moved to TripEngine.step(plan, state.copy(clockOffsetS = offset), TripEvent.Tick(clock.instant()))
    }

    /** Whether ride [legIndex] of [a] and [b] runs the same line between the same stops: one train or the other. */
    private fun sameRide(a: TripPlan, b: TripPlan, legIndex: Int): Boolean {
        val one = a.legs.getOrNull(legIndex) as? TripLeg.Ride ?: return false
        val other = b.legs.getOrNull(legIndex) as? TripLeg.Ride ?: return false
        return one.line == other.line && one.stops.map { it.id } == other.stops.map { it.id }
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

    /** The trip that ended at [at] had its log uploaded: its last page thanks the rider instead of asking. */
    fun markUploaded(at: Instant) {
        scope.launch {
            mutex.withLock {
                val finished = _finished.value?.takeIf { it.at == at && !it.uploaded } ?: return@withLock
                finished.copy(uploaded = true).also {
                    _finished.value = it
                    store.writeFinished(it)
                }
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
     *
     * A rider seen once past the platform at a train's pace is likely on it, late: nothing is asked
     * until the next fix says. Setiabudi's and Sudirman's on 15 Oct were each a minute and a half
     * behind time, and called gone between the fix that saw them leave and the one that boarded.
     */
    private fun replanIfMissed(trip: ActiveTrip) {
        val state = trip.state
        val now = clock.instant()
        val (legIndex, readyAt) = when (state.phase) {
            TripPhase.WAITING_TO_BOARD -> {
                if (state.boardingFixes > 0) return
                state.legIndex to maxOf(now, state.walkEndsAt(trip.plan) ?: now)
            }
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
        log.event("replan", mapOf("leg" to legIndex, "departs" to departs, "ready" to readyAt))
        replanJob = scope.launch {
            val onward = replanner.replan(ride.stops.first().id, trip.plan.destination.id, readyAt, ride.line)
                ?.let { locator.place(it) }
                ?.takeIf { it.legs.firstOrNull() is TripLeg.Ride }
            if (onward == null) {
                log.event("missed", mapOf("leg" to legIndex, "departs" to departs, "ready" to readyAt, "onward" to null))
                // Offline, say: ask again once it's had a while. A rider walking gives no fix to step
                // on, so the step is made here, apart from this job, which a waiting alarm joins.
                scope.launch {
                    delay(REPLAN_RETRY.toMillis())
                    if (replannedFor != key) return@launch
                    replannedFor = null
                    tick()
                }
                return@launch
            }
            mutex.withLock {
                val current = _active.value ?: return@withLock
                // Moved on meanwhile (boarded it after all, or already re-planned): leave it be.
                val boarded = current.state.legIndex > legIndex ||
                    (current.state.legIndex == legIndex && current.state.phase != TripPhase.WAITING_TO_BOARD)
                if (current.plan != trip.plan || boarded) return@withLock
                // Seen leaving meanwhile, likely aboard: asked again only if the next fix says not.
                if (current.state.boardingFixes > 0) {
                    replannedFor = null
                    return@withLock
                }
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
     * the board shows it, and [boardedEarlier] puts it back if the late one turns up. Seen pulling
     * along the platform counts: that is the late one leaving, likely with them aboard.
     */
    private fun onPlatform(plan: TripPlan, state: TripState): Boolean =
        state.phase == TripPhase.WAITING_TO_BOARD && state.walkingSince == null &&
            state.source == PositionSource.CONFIRMED && TripEngine.seenAtPlatform(plan, state)

    /**
     * Whether a swap is news to tell the rider now: waiting, unless [onPlatform]; aboard, within
     * [EARLY_REPLAN] of getting in, near enough that the lateness won't be made up.
     */
    private fun tells(plan: TripPlan, state: TripState, now: Instant): Boolean = when (state.phase) {
        TripPhase.WAITING_TO_BOARD -> !onPlatform(plan, state)
        TripPhase.RIDING -> state.expectedAlightingAt(plan)?.isAfter(now.plus(EARLY_REPLAN)) != true
        else -> false
    }

    /**
     * Swapped untold from aboard, and the train has made up the time: ride [legIndex] can be caught
     * after all ([readyAt] a [TAKE_BACK_MARGIN] or more before it leaves), so it's back, without
     * asking. A swap the rider was told of stays; [boardedEarlier] still takes it back if they make
     * the train regardless. Called with the lock held.
     */
    private fun takeBack(trip: ActiveTrip, legIndex: Int, readyAt: Instant): Boolean {
        val replaced = trip.replaced ?: return false
        if (trip.state.phase != TripPhase.RIDING || replaced.legIndex != legIndex || replaced.untold == null) return false
        val departs = replaced.plan.ride(legIndex).departureAt ?: return false
        if (readyAt.isAfter(departs.minus(TAKE_BACK_MARGIN))) return false
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

        /**
         * A swap is undone only with this much to spare: a walk is not timed to the second, and on
         * 19 Oct a change given back with one second in hand was lost to a nine-minute walk.
         */
        val TAKE_BACK_MARGIN: Duration = Duration.ofMinutes(1)

        /**
         * How soon before the late ride gets in a missed change is told from aboard it: near enough
         * that its lateness won't be made up, early enough to sit with the news.
         */
        val EARLY_REPLAN: Duration = Duration.ofMinutes(10)

        /** The most a train is taken to run ahead of its time, as the engine's own bound is. */
        const val MAX_EARLY_S = -5 * 60L

        /** How long before asking again when a re-plan found nothing. */
        val REPLAN_RETRY: Duration = Duration.ofMinutes(2)

        /**
         * Boarded this far ahead of the train a ride was swapped for, it's the one before. Trains
         * don't leave two minutes early; tonight's were five and six ahead.
         */
        val EARLIER_TRAIN: Duration = Duration.ofMinutes(2)

        /**
         * Out of a station this far ahead of a train's time there, it's not that train: 16 Oct's left
         * Manggarai four minutes before the 19.02 was due, and five and a half after the 18.57.
         */
        val LEFT_EARLY: Duration = Duration.ofMinutes(2)
    }
}

/** A trip that has ended: as it stood at the end, why it ended, and when. */
@Serializable
data class FinishedTrip(
    val trip: ActiveTrip,
    val reason: FinishReason,
    @Serializable(with = InstantSerializer::class)
    val at: Instant,
    /** The rider sent its log from the last page ("Upload OTW Ini"): once is enough. */
    val uploaded: Boolean = false,
)

/** How long a finished trip's summary stays: about the rest of a day out. */
private val FINISHED_KEPT: Duration = Duration.ofHours(6)
