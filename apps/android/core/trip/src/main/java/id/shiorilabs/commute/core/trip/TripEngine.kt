package id.shiorilabs.commute.core.trip

import id.shiorilabs.commute.core.geo.GeoPoint
import id.shiorilabs.commute.core.geo.distanceM
import id.shiorilabs.commute.core.geo.project
import java.time.Duration
import java.time.Instant
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min

/**
 * The trip engine: given where a trip stands and something that happened, where it stands now and
 * what to tell the rider. Pure and deterministic, so every scenario is a unit test.
 *
 * Three sources place the rider, in order of trust (`android-trip-mode.md`): a fix near the route,
 * the timetable, and nothing. A fix always wins and re-bases the clock; the clock carries the trip
 * where there are no fixes (underground, in tunnels); an untimed ride with no fix says so.
 */
object TripEngine {

    /** Rail stations are long and fixes on a train are rough. */
    private const val RAIL_STOP_RADIUS_M = 250.0
    private const val RAIL_CORRIDOR_M = 400.0
    private const val RAIL_ACCURACY_GATE_M = 250f
    private const val RAIL_OFF_ROUTE_M = 1_000.0
    private const val RAIL_MISSED_M = 600.0

    /** TransJakarta haltes are a few hundred metres apart, on the road itself. */
    private const val BUS_STOP_RADIUS_M = 100.0
    private const val BUS_CORRIDOR_M = 150.0
    private const val BUS_ACCURACY_GATE_M = 100f
    private const val BUS_OFF_ROUTE_M = 500.0
    private const val BUS_MISSED_M = 300.0

    /** How many stops ahead a fix may place the rider: far enough for a long gap, not a loop's far side. */
    private const val LOOKAHEAD_STOPS = 6

    /** A fix this far behind the confirmed point is jitter, and still counts as "on the route here". */
    private const val JITTER = 0.25

    /** Past this along the first hop, the rider is on the vehicle. */
    private const val BOARDED_AT = 0.3

    /** Consecutive far-off fixes before asking whether the rider is still on this route. */
    private const val OFF_ROUTE_STRIKES = 3

    /** How long a fix keeps the position confirmed before the clock takes over again. */
    val STALE: Duration = Duration.ofMinutes(3)

    /** After the clock says the vehicle arrived, how long before the trip moves on without a fix. */
    val ALIGHT_GRACE: Duration = Duration.ofMinutes(2)

    /** A final hop longer than this gets its "siap-siap" by time instead of one stop before. */
    val LONG_HOP: Duration = Duration.ofMinutes(5)
    val PREPARE_LEAD: Duration = Duration.ofMinutes(3)

    /** The trip ends itself this long after arriving. */
    val ARRIVED_LINGER: Duration = Duration.ofMinutes(5)

    private val UNTIMED_TIMEOUT: Duration = Duration.ofHours(3)
    private val MIN_TIMEOUT: Duration = Duration.ofMinutes(90)
    private val TIMEOUT_SLACK: Duration = Duration.ofMinutes(60)

    private val MAX_EARLY_S = -5 * 60L
    private val MAX_LATE_S = 90 * 60L

    /** A trip just started at [now]. */
    fun start(plan: TripPlan, now: Instant, hasLocation: Boolean): TripStep {
        val first = plan.rideIndices.first()
        val state = TripState(
            legIndex = first,
            phase = TripPhase.WAITING_TO_BOARD,
            source = if (plan.ride(first).isTimed) PositionSource.ESTIMATED else PositionSource.UNKNOWN,
            hasLocation = hasLocation,
            locationMode = TripLocationMode.OFF,
            startedAt = now,
        )
        return settle(plan, state, now, mutableListOf())
    }

    fun step(plan: TripPlan, state: TripState, event: TripEvent): TripStep {
        val effects = mutableListOf<TripEffect>()
        val now = event.at
        val next = when (event) {
            is TripEvent.Fix -> onFix(plan, state, event, effects)
            is TripEvent.Tick -> state
            is TripEvent.LocationAvailability -> state.copy(hasLocation = event.available)
            // A fix from just before the restart still places the rider; an old one goes stale on
            // its own. Dropping it would let the clock run them ahead, and alert, the moment the
            // process came back.
            is TripEvent.Resumed -> state.copy(resumed = true)
            is TripEvent.RiderSaid -> when (event.action) {
                RiderAction.STOP -> {
                    effects += TripEffect.Finished(FinishReason.STOPPED)
                    return TripStep(state.copy(locationMode = TripLocationMode.OFF), effects, null)
                }
                RiderAction.STILL_ON_ROUTE -> state.copy(offRouteStrikes = 0, askedStillOnRoute = false)
                // Not a fix: the clock runs from the moment they boarded, a train that left late
                // being late for the whole leg, but nothing is confirmed.
                RiderAction.BOARDED -> if (state.phase == TripPhase.WAITING_TO_BOARD) {
                    val late = plan.ride(state.legIndex).departureAt
                        ?.let { Duration.between(it, now).seconds.coerceIn(0, MAX_LATE_S) }
                        ?: 0
                    state.copy(phase = TripPhase.RIDING, clockOffsetS = late)
                } else {
                    state
                }
                RiderAction.ALIGHTED -> if (state.phase == TripPhase.ARRIVED) {
                    state
                } else {
                    completeRide(plan, state, now, estimated = false, effects)
                }
            }
        }
        return settle(plan, next, now, effects)
    }

    // ---- Fixes ----

    private fun onFix(plan: TripPlan, state: TripState, fix: TripEvent.Fix, effects: MutableList<TripEffect>): TripState {
        if (state.phase == TripPhase.ARRIVED) return state
        val ride = plan.ride(state.legIndex)
        val tuning = Tuning.of(ride)
        if (fix.accuracyM > tuning.accuracyGate) return state.copy(hasLocation = true)

        val candidate = locate(ride, state.confirmedPosition, fix.point, tuning)
        if (candidate != null && candidate >= state.confirmedPosition - JITTER) {
            val confirmed = max(candidate, state.confirmedPosition)
            var phase = state.phase
            if (phase == TripPhase.WAITING_TO_BOARD && confirmed >= BOARDED_AT) phase = TripPhase.RIDING
            val offset = if (phase == TripPhase.RIDING && candidate > 0 && candidate >= state.confirmedPosition) {
                RideClock(ride).scheduledAt(candidate)
                    ?.let { Duration.between(it, fix.at).seconds.coerceIn(MAX_EARLY_S, MAX_LATE_S) }
                    ?: state.clockOffsetS
            } else {
                state.clockOffsetS
            }
            return state.copy(
                phase = phase,
                confirmedPosition = confirmed,
                confirmedAt = fix.at,
                clockOffsetS = offset,
                offRouteStrikes = 0,
                hasLocation = true,
                resumed = false,
            )
        }

        if (state.phase != TripPhase.RIDING) return state.copy(hasLocation = true)

        if (isPastAlighting(ride, fix.point, tuning) && max(state.position, state.confirmedPosition) >= ride.lastIndex - 1) {
            fire(state, AlertKind.MISSED, estimated = false, effects)?.let { return it.copy(hasLocation = true) }
            return state.copy(hasLocation = true)
        }

        if (distanceFromRide(ride, fix.point) > tuning.offRoute) {
            val strikes = state.offRouteStrikes + 1
            if (strikes >= OFF_ROUTE_STRIKES && !state.askedStillOnRoute) {
                effects += TripEffect.AskStillOnRoute
                return state.copy(offRouteStrikes = strikes, askedStillOnRoute = true, hasLocation = true)
            }
            return state.copy(offRouteStrikes = strikes, hasLocation = true)
        }
        return state.copy(hasLocation = true)
    }

    /**
     * Where along [ride] a fix at [point] puts the rider, looking only ahead of [from]: at a stop
     * when within its radius, else projected onto the nearest hop it runs alongside.
     */
    private fun locate(ride: TripLeg.Ride, from: Double, point: GeoPoint, tuning: Tuning): Double? {
        val start = floor(from).toInt().coerceIn(0, ride.lastIndex)
        val end = min(ride.lastIndex, start + LOOKAHEAD_STOPS)

        var bestStop: Int? = null
        var bestStopDistance = Double.MAX_VALUE
        for (i in start..end) {
            val stop = ride.stops[i].point ?: continue
            val d = distanceM(point, stop)
            if (d <= tuning.stopRadius && d < bestStopDistance) {
                bestStop = i
                bestStopDistance = d
            }
        }
        if (bestStop != null) return bestStop.toDouble()

        var bestHop: Double? = null
        var bestOffTrack = Double.MAX_VALUE
        for (k in start until end) {
            val a = ride.stops[k].point ?: continue
            val b = ride.stops[k + 1].point ?: continue
            val projection = project(point, a, b)
            // Beyond either end of the hop is only "on it" within a stop's radius, or a fix just past
            // the alighting station would read as arriving there.
            val atEnd = projection.fraction <= 0.0 || projection.fraction >= 1.0
            val limit = if (atEnd) tuning.stopRadius else tuning.corridor
            if (projection.offTrackM <= limit && projection.offTrackM < bestOffTrack) {
                bestHop = k + projection.fraction
                bestOffTrack = projection.offTrackM
            }
        }
        return bestHop
    }

    /** Beyond the alighting stop, on the far side from the stop before it, and well clear of it. */
    private fun isPastAlighting(ride: TripLeg.Ride, point: GeoPoint, tuning: Tuning): Boolean {
        val alighting = ride.stops.last().point ?: return false
        val before = ride.stops[ride.lastIndex - 1].point ?: return false
        return distanceM(point, before) > distanceM(alighting, before) + tuning.stopRadius &&
            distanceM(point, alighting) > tuning.missed
    }

    /** The distance from [point] to the nearest stop or hop of the whole ride. */
    private fun distanceFromRide(ride: TripLeg.Ride, point: GeoPoint): Double {
        var best = Double.MAX_VALUE
        val points = ride.stops.map { it.point }
        for (i in points.indices) {
            val p = points[i] ?: continue
            best = min(best, distanceM(point, p))
            val q = points.getOrNull(i + 1) ?: continue
            best = min(best, project(point, p, q).offTrackM)
        }
        return best
    }

    // ---- The clock, leg changes and alerts ----

    /**
     * Brings [state] up to [now]: the clock's estimate, finished rides (more than one after a long
     * sleep), the alerts they cross, the location mode, and when to look again.
     */
    private fun settle(plan: TripPlan, initial: TripState, now: Instant, effects: MutableList<TripEffect>): TripStep {
        var state = initial
        noticeUnplaceable(plan, state, effects)?.let { state = it }

        // Each pass either finishes a ride or stops; a trip has finitely many.
        while (state.phase != TripPhase.ARRIVED) {
            val ride = plan.ride(state.legIndex)
            val clock = RideClock(ride)
            val fresh = state.confirmedAt?.let { Duration.between(it, now) < STALE } == true
            val offset = Duration.ofSeconds(state.clockOffsetS)

            if (state.phase == TripPhase.WAITING_TO_BOARD) {
                val departs = ride.departureAt?.plus(offset)
                if (ride.isTimed && !fresh && departs != null && !now.isBefore(departs)) {
                    state = state.copy(phase = TripPhase.RIDING)
                } else {
                    state = state.copy(source = sourceOf(ride, fresh), position = state.confirmedPosition)
                    break
                }
            }

            val estimate = clock.positionAt(now.minus(offset))
            val position = if (fresh || estimate == null) state.confirmedPosition else max(state.confirmedPosition, estimate)
            state = state.copy(position = position, source = sourceOf(ride, fresh))

            // Reached the alighting stop already (a long sleep, a sparse fix): too late for
            // "siap-siap", which is skipped below rather than sent after the fact.
            if (position < ride.lastIndex) state = prepareIfDue(ride, clock, state, now, effects)

            if (position >= ride.lastIndex) {
                fire(state, AlertKind.PREPARE, estimated = state.source != PositionSource.CONFIRMED, mutableListOf())
                    ?.let { state = it }
                // After "kelewatan?" the clock catching up has nothing to add.
                val missed = "${AlertKind.MISSED.name}:${state.legIndex}" in state.firedAlerts
                fire(state, AlertKind.ALIGHT, estimated = state.source != PositionSource.CONFIRMED, if (missed) mutableListOf() else effects)
                    ?.let { state = it }
                val arrives = ride.arrivalAt?.plus(offset)
                val moveOn = state.confirmedPosition >= ride.lastIndex ||
                    (arrives != null && !now.isBefore(arrives.plus(ALIGHT_GRACE)))
                if (moveOn) {
                    state = completeRide(plan, state, now, estimated = state.confirmedPosition < ride.lastIndex, effects)
                    noticeUnplaceable(plan, state, effects)?.let { state = it }
                    continue
                }
            }
            break
        }

        val finish = when {
            state.phase == TripPhase.ARRIVED && state.arrivedAt != null &&
                !now.isBefore(state.arrivedAt.plus(ARRIVED_LINGER)) -> FinishReason.ARRIVED
            !now.isBefore(deadline(plan, state)) -> FinishReason.TIMED_OUT
            else -> null
        }
        if (finish != null) {
            effects += TripEffect.Finished(finish)
            return TripStep(state.copy(locationMode = TripLocationMode.OFF), effects, null)
        }

        val mode = locationModeFor(plan, state)
        if (mode != state.locationMode) {
            effects += TripEffect.SetLocationMode(mode)
            state = state.copy(locationMode = mode)
        }
        return TripStep(state, effects, nextWake(plan, state, now))
    }

    /**
     * "Siap-siap": one stop before the alighting stop, or, when that last hop is long, about three
     * minutes before reaching it.
     */
    private fun prepareIfDue(
        ride: TripLeg.Ride,
        clock: RideClock,
        state: TripState,
        now: Instant,
        effects: MutableList<TripEffect>,
    ): TripState {
        if (prepareKey(state.legIndex) in state.firedAlerts) return state
        if (state.position < ride.lastIndex - 1) return state
        val hopStart = clock.scheduledAt((ride.lastIndex - 1).toDouble())
        val hopEnd = clock.scheduledAt(ride.lastIndex.toDouble())
        val due = if (hopStart != null && hopEnd != null && Duration.between(hopStart, hopEnd) > LONG_HOP) {
            val atPosition = clock.scheduledAt(state.position)!!
            Duration.between(atPosition, hopEnd) <= PREPARE_LEAD
        } else {
            true
        }
        if (!due) return state
        return fire(state, AlertKind.PREPARE, estimated = state.source != PositionSource.CONFIRMED, effects) ?: state
    }

    /** Off the current ride: on to the next one, or arrived. */
    private fun completeRide(
        plan: TripPlan,
        state: TripState,
        now: Instant,
        estimated: Boolean,
        effects: MutableList<TripEffect>,
    ): TripState {
        val ride = plan.ride(state.legIndex)
        var next = state.copy(position = ride.lastIndex.toDouble())
        fire(next, AlertKind.PREPARE, estimated, mutableListOf())?.let { next = it }
        fire(next, AlertKind.ALIGHT, estimated, effects)?.let { next = it }

        val following = plan.nextRideAfter(state.legIndex)
            ?: return next.copy(
                phase = TripPhase.ARRIVED,
                arrivedAt = now,
                confirmedPosition = ride.lastIndex.toDouble(),
                offRouteStrikes = 0,
            )
        return next.copy(
            legIndex = following,
            phase = TripPhase.WAITING_TO_BOARD,
            confirmedPosition = 0.0,
            position = 0.0,
            clockOffsetS = 0,
            // Confirmed off at the station where the change starts; an estimate confirms nothing.
            confirmedAt = if (estimated) null else next.confirmedAt ?: now,
            offRouteStrikes = 0,
            askedStillOnRoute = false,
        )
    }

    /** The one honest notice for a ride nothing can place: untimed, and no fixes to be had. */
    private fun noticeUnplaceable(plan: TripPlan, state: TripState, effects: MutableList<TripEffect>): TripState? {
        if (state.phase == TripPhase.ARRIVED) return null
        val ride = plan.ride(state.legIndex)
        if (ride.isTimed) return null
        val placeable = state.hasLocation && ride.stops.count { it.point != null } >= 2
        if (placeable) return null
        return fire(state, AlertKind.NO_REMINDERS, estimated = true, effects)
    }

    private fun sourceOf(ride: TripLeg.Ride, fresh: Boolean): PositionSource = when {
        fresh -> PositionSource.CONFIRMED
        ride.isTimed -> PositionSource.ESTIMATED
        else -> PositionSource.UNKNOWN
    }

    /** Fires [kind] for the current leg unless it already has; the new state, or `null` if it had. */
    private fun fire(state: TripState, kind: AlertKind, estimated: Boolean, effects: MutableList<TripEffect>): TripState? {
        val key = "${kind.name}:${state.legIndex}"
        if (key in state.firedAlerts) return null
        effects += TripEffect.Alert(kind, state.legIndex, estimated)
        return state.copy(firedAlerts = state.firedAlerts + key)
    }

    private fun prepareKey(legIndex: Int) = "${AlertKind.PREPARE.name}:$legIndex"

    private fun locationModeFor(plan: TripPlan, state: TripState): TripLocationMode = when {
        !state.hasLocation || state.phase == TripPhase.ARRIVED -> TripLocationMode.OFF
        state.phase == TripPhase.RIDING && state.position >= plan.ride(state.legIndex).lastIndex - 2 -> TripLocationMode.PRECISE
        else -> TripLocationMode.BALANCED
    }

    /**
     * When the trip gives up on its own, so a forgotten one doesn't run all night: twice the planned
     * duration plus an hour when the last ride is timed, three hours when it isn't.
     */
    fun deadline(plan: TripPlan, state: TripState): Instant {
        val lastArrival = plan.ride(plan.rideIndices.last()).takeIf { it.isTimed }?.arrivalAt
            ?: return state.startedAt.plus(UNTIMED_TIMEOUT)
        val planned = Duration.between(state.startedAt, lastArrival).coerceAtLeast(Duration.ZERO)
        val timeout = planned.multipliedBy(2).plus(TIMEOUT_SLACK)
        return state.startedAt.plus(if (timeout < MIN_TIMEOUT) MIN_TIMEOUT else timeout)
    }

    /** The next moment the clock alone changes something. */
    private fun nextWake(plan: TripPlan, state: TripState, now: Instant): Instant? {
        val candidates = mutableListOf(deadline(plan, state))
        state.arrivedAt?.let { candidates += it.plus(ARRIVED_LINGER) }
        state.confirmedAt?.let { candidates += it.plus(STALE) }
        if (state.phase != TripPhase.ARRIVED) {
            val ride = plan.ride(state.legIndex)
            val clock = RideClock(ride)
            val offset = Duration.ofSeconds(state.clockOffsetS)
            if (ride.isTimed) {
                when (state.phase) {
                    TripPhase.WAITING_TO_BOARD -> candidates += ride.departureAt!!.plus(offset)
                    else -> {
                        val nextStop = floor(state.position).toInt() + 1
                        if (nextStop <= ride.lastIndex) clock.scheduledAt(nextStop.toDouble())?.let { candidates += it.plus(offset) }
                        val arrives = ride.arrivalAt!!.plus(offset)
                        candidates += arrives.minus(PREPARE_LEAD)
                        candidates += arrives
                        candidates += arrives.plus(ALIGHT_GRACE)
                    }
                }
            }
        }
        return candidates.filter { it.isAfter(now) }.minOrNull()
    }

    private fun Duration.coerceAtLeast(min: Duration) = if (this < min) min else this

    private class Tuning(
        val stopRadius: Double,
        val corridor: Double,
        val accuracyGate: Float,
        val offRoute: Double,
        val missed: Double,
    ) {
        companion object {
            private val RAIL = Tuning(RAIL_STOP_RADIUS_M, RAIL_CORRIDOR_M, RAIL_ACCURACY_GATE_M, RAIL_OFF_ROUTE_M, RAIL_MISSED_M)
            private val BUS = Tuning(BUS_STOP_RADIUS_M, BUS_CORRIDOR_M, BUS_ACCURACY_GATE_M, BUS_OFF_ROUTE_M, BUS_MISSED_M)

            fun of(ride: TripLeg.Ride) = if (ride.isBus) BUS else RAIL
        }
    }
}
