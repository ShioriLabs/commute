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

    /**
     * Half the longest train either side of the station's point, and this for the fixes' own error:
     * the train is in. A twelve-car KRL comes to 150 m.
     */
    private const val RAIL_AT_STOP_SLACK_M = 30.0

    /** A line whose trains aren't known gets the longest's radius, a twelve-car KRL's. */
    private const val RAIL_AT_STOP_M = 150.0
    private const val RAIL_CORRIDOR_M = 400.0
    private const val RAIL_ACCURACY_GATE_M = 250f
    private const val RAIL_OFF_ROUTE_M = 1_000.0
    private const val RAIL_MISSED_M = 600.0

    /** TransJakarta haltes are a few hundred metres apart, on the road itself. */
    private const val BUS_STOP_RADIUS_M = 100.0
    private const val BUS_AT_STOP_M = 70.0
    private const val BUS_CORRIDOR_M = 150.0
    private const val BUS_ACCURACY_GATE_M = 100f
    private const val BUS_OFF_ROUTE_M = 500.0
    private const val BUS_MISSED_M = 300.0

    /**
     * Slower than this by a station, by the satellites' own speed, the train is stopping there; faster,
     * it is still rolling in or already pulling out. About 20 km/h: braking at a KRL's 0.8–1 m/s², five
     * to ten seconds from standing, so "Sekarang di" lands just before the train does.
     */
    private const val STOPPING_M_PER_S = 6.0

    /** How far short of a station a train still rolling in through its radius is put. */
    private const val ROLLING_IN = 0.01

    /** How many stops ahead a fix may place the rider: far enough for a long gap, not a loop's far side. */
    private const val LOOKAHEAD_STOPS = 6

    /** A fix this far behind the confirmed point is jitter, and still counts as "on the route here". */
    private const val JITTER = 0.25

    /** Past this along the first hop, and seen getting there at [RIDING_M_PER_S], a rider still walking from the last ride is on the vehicle. */
    private const val BOARDED_AT = 0.3

    /** Faster than anyone walks (about 7 km/h); slower than a train pulling out or a bus in traffic. */
    private const val RIDING_M_PER_S = 2.0

    /** Slower than this, by the satellites, the train is standing still. */
    private const val STANDING_M_PER_S = 1.0

    /**
     * Fixes in a row at [RIDING_M_PER_S] or more, after standing at a stop, that take a train out of
     * it while still slower than [STOPPING_M_PER_S]: one could be a jolt; two is the train leaving.
     */
    private const val PULLING_OUT_FIXES = 2

    /**
     * How far on along the route fixes must carry a bus past a halte it was never seen near before
     * they're believed. Hops are straight lines and roads aren't: L13E reaches Tegal Mampang down
     * Mampang and back east along Tendean, under the hop on to CSW, and one fix there put the bus a
     * halte on and sent "siap-siap" 22 minutes early. Heading the wrong way, it never gets on.
     */
    private const val PASSING_PROGRESS_M = 100.0

    /** Consecutive far-off fixes before asking whether the rider is still on this route. */
    private const val OFF_ROUTE_STRIKES = 3

    /** How long a fix keeps the position confirmed before the clock takes over again. */
    val STALE: Duration = Duration.ofMinutes(3)

    /** After the clock says the vehicle arrived, how long before the trip moves on without a fix. */
    val ALIGHT_GRACE: Duration = Duration.ofMinutes(2)

    /** A final hop longer than this gets its "siap-siap" by time instead of on leaving the stop before. */
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
                // Done with a trip that already got there is arriving, not giving up on it.
                RiderAction.STOP -> {
                    effects += TripEffect.Finished(if (state.phase == TripPhase.ARRIVED) FinishReason.ARRIVED else FinishReason.STOPPED)
                    return TripStep(state.copy(locationMode = TripLocationMode.OFF), effects, null)
                }
                RiderAction.STILL_ON_ROUTE -> state.copy(offRouteStrikes = 0, askedStillOnRoute = false)
                // Not a fix: the clock runs from the moment they boarded, a train that left late
                // being late for the whole leg, but nothing is confirmed.
                RiderAction.BOARDED -> if (state.phase == TripPhase.WAITING_TO_BOARD) {
                    val late = plan.ride(state.legIndex).departureAt
                        ?.let { Duration.between(it, now).seconds.coerceIn(0, MAX_LATE_S) }
                        ?: 0
                    state.copy(
                        phase = TripPhase.RIDING,
                        clockOffsetS = late,
                        stopTimes = state.stopTimes + (stopKey(state.legIndex, 0) to now.toEpochMilli()),
                    )
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

        val located = locate(ride, state.confirmedPosition, fix, tuning)
        val pullOut = pullOut(ride, state, fix, located, tuning)
        val tracked = state.copy(stoodAt = pullOut.stoodAt, pullingOutFixes = pullOut.fixes)
        val candidate = pullOut.leftTo ?: located
        if (candidate != null && candidate >= state.confirmedPosition - JITTER) {
            // Seen near the line but not aboard: the fix says where they are, not how far they've
            // come. A walk ends only nearer the station it goes to, as a change can run beside the
            // next line out of the station it left.
            if (state.phase == TripPhase.WAITING_TO_BOARD && !boards(ride, state, candidate, fix, tuning)) {
                val walked = state.walkingSince != null && reachedAfterWalk(plan, state.legIndex, fix.point)
                return tracked.copy(
                    sightedPosition = candidate,
                    confirmedAt = fix.at,
                    offRouteStrikes = 0,
                    hasLocation = true,
                    resumed = false,
                    walkingSince = if (walked) null else state.walkingSince,
                )
            }
            if (state.phase == TripPhase.RIDING && ride.isBus && passesUnseenStop(ride, state.confirmedPosition, candidate, tuning)) {
                val from = state.passingFrom?.let { min(it, candidate) } ?: candidate
                if (metresAlong(ride, from, candidate) < PASSING_PROGRESS_M) {
                    return tracked.copy(passingFrom = from, hasLocation = true)
                }
            }
            val confirmed = max(candidate, state.confirmedPosition)
            val offset = if (candidate > 0 && candidate >= state.confirmedPosition) {
                RideClock(ride).scheduledAt(candidate)
                    ?.let { Duration.between(it, fix.at).seconds.coerceIn(MAX_EARLY_S, MAX_LATE_S) }
                    ?: state.clockOffsetS
            } else {
                state.clockOffsetS
            }
            // At a stop, riding: when the train was there. The last fix while it waits, so about
            // when it left; at the stop to get off at, the first, when it got in.
            val stop = candidate.toInt().takeIf { candidate == floor(candidate) }
            val key = stop?.let { stopKey(state.legIndex, it) }
            val stopTimes = if (key == null || (stop == ride.lastIndex && key in state.stopTimes)) {
                state.stopTimes
            } else {
                state.stopTimes + (key to fix.at.toEpochMilli())
            }
            // On the ride: whatever walk came before it is over.
            return tracked.copy(
                phase = TripPhase.RIDING,
                confirmedPosition = confirmed,
                confirmedAt = fix.at,
                clockOffsetS = offset,
                offRouteStrikes = 0,
                hasLocation = true,
                resumed = false,
                walkingSince = null,
                sightedPosition = null,
                stopTimes = stopTimes,
                passingFrom = null,
            )
        }

        if (state.phase != TripPhase.RIDING) return tracked.copy(hasLocation = true)

        if (isPastAlighting(ride, fix.point, tuning) && max(state.position, state.confirmedPosition) >= ride.lastIndex - 1) {
            fire(tracked, AlertKind.MISSED, estimated = false, effects)?.let { return it.copy(hasLocation = true) }
            return tracked.copy(hasLocation = true)
        }

        if (distanceFromRide(ride, fix.point) > tuning.offRoute) {
            val strikes = state.offRouteStrikes + 1
            if (strikes >= OFF_ROUTE_STRIKES && !state.askedStillOnRoute) {
                effects += TripEffect.AskStillOnRoute
                return tracked.copy(offRouteStrikes = strikes, askedStillOnRoute = true, hasLocation = true)
            }
            return tracked.copy(offRouteStrikes = strikes, hasLocation = true)
        }
        return tracked.copy(hasLocation = true)
    }

    /** What [pullOut] makes of a fix: the stop being watched, the fixes counted, where it left to. */
    private class PullOut(val stoodAt: String?, val fixes: Int, val leftTo: Double?)

    /**
     * Watches a train at a stop on the way for leaving it slower than [STOPPING_M_PER_S]: seen
     * standing there, then [PULLING_OUT_FIXES] fixes in a row moving at a train's pace, and past the
     * stop's point, it has left, and [PullOut.leftTo] is where along the next hop. A fix without a
     * speed says nothing either way. Jatinegara held a train crawling out until 235 m on without it.
     * The stop is the one the train was at, or, for the fix that brings it in, the one [located] there.
     */
    private fun pullOut(ride: TripLeg.Ride, state: TripState, fix: TripEvent.Fix, located: Double?, tuning: Tuning): PullOut {
        if (state.phase != TripPhase.RIDING) return PullOut(null, 0, null)
        val here = located?.takeIf { it == floor(it) && it > state.confirmedPosition }
            ?: state.confirmedPosition.takeIf { it == floor(it) }
        val stop = here?.toInt()?.takeIf { it < ride.lastIndex } ?: return PullOut(null, 0, null)
        val key = stopKey(state.legIndex, stop)
        val watching = state.stoodAt.takeIf { it == key }
        val speed = fix.speedMps ?: return PullOut(watching, if (watching == null) 0 else state.pullingOutFixes, null)
        if (speed < STANDING_M_PER_S) return PullOut(key, 0, null)
        if (watching == null || speed < RIDING_M_PER_S) return PullOut(watching, 0, null)
        val fixes = state.pullingOutFixes + 1
        if (fixes < PULLING_OUT_FIXES) return PullOut(key, fixes, null)
        val along = alongHops(ride, stop, min(ride.lastIndex, stop + LOOKAHEAD_STOPS), fix.point, tuning)
        return PullOut(key, fixes, along?.takeIf { it > stop })
    }

    /**
     * Where along [ride] [fix] puts the rider, looking only ahead of [from]: at a stop when the train
     * is in (within [Tuning.atStop]), else projected onto the nearest hop it runs alongside, so one
     * still rolling in is a little short of the stop rather than at it.
     *
     * A station on the way is only "in" once the train has slowed there: at speed it is still rolling
     * in, short of it, or pulling out, past it. The stop to get off at is in as soon as it's reached,
     * when "turun" is most use; and a fix without a speed is taken at its word.
     */
    private fun locate(ride: TripLeg.Ride, from: Double, fix: TripEvent.Fix, tuning: Tuning): Double? {
        val point = fix.point
        val start = floor(from).toInt().coerceIn(0, ride.lastIndex)
        val end = min(ride.lastIndex, start + LOOKAHEAD_STOPS)

        var bestStop: Int? = null
        var bestStopDistance = Double.MAX_VALUE
        for (i in start..end) {
            val stop = ride.stops[i].point ?: continue
            val d = distanceM(point, stop)
            if (d <= tuning.atStop && d < bestStopDistance) {
                bestStop = i
                bestStopDistance = d
            }
        }
        if (bestStop != null) {
            val moving = fix.speedMps != null && fix.speedMps >= STOPPING_M_PER_S
            if (!moving || bestStop == ride.lastIndex) return bestStop.toDouble()
            val along = alongHops(ride, start, end, point, tuning)
            if (bestStop <= from) return along
            val short = bestStop - ROLLING_IN
            return if (along == null) short else min(along, short)
        }
        return alongHops(ride, start, end, point, tuning)
    }

    /** [point] projected onto the nearest hop from stop [start] to stop [end] it runs alongside. */
    private fun alongHops(ride: TripLeg.Ride, start: Int, end: Int, point: GeoPoint, tuning: Tuning): Double? {
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

    /**
     * Whether a rider waiting for [ride], last seen at [TripState.sightedPosition], is aboard now
     * [candidate] puts them past the platform's end: they came further than the fix could wander,
     * faster than walking, and the satellites, when they say, have them moving too. Setiabudi's LRT
     * was 140 m out at 5 m/s, a sixth of its hop, when a third was asked for.
     *
     * Still walking from the last ride, only [BOARDED_AT] of the hop will do: the station walked
     * from can lie beside this line, past its platform (Dukuh Atas LRT is 270 m along the KRL out
     * of Sudirman), where one rough fix leaping on would otherwise board them.
     */
    private fun boards(ride: TripLeg.Ride, state: TripState, candidate: Double, fix: TripEvent.Fix, tuning: Tuning): Boolean {
        val pastPlatform = if (state.walkingSince != null) candidate >= BOARDED_AT else metresAlong(ride, 0.0, candidate) > tuning.atStop
        if (!pastPlatform) return false
        if (fix.speedMps != null && fix.speedMps < RIDING_M_PER_S) return false
        val from = state.sightedPosition ?: return false
        val since = state.confirmedAt ?: return false
        val seconds = Duration.between(since, fix.at).toMillis() / 1000.0
        val moved = metresAlong(ride, from, candidate)
        return seconds > 0 && moved > fix.accuracyM && moved / seconds >= RIDING_M_PER_S
    }

    /**
     * Whether [to] lies beyond a stop the rider at [from] was never near: more than a stop's radius
     * short of the next one, and now past it rather than at it.
     */
    private fun passesUnseenStop(ride: TripLeg.Ride, from: Double, to: Double, tuning: Tuning): Boolean {
        if (to == floor(to)) return false
        val next = floor(from).toInt() + 1
        return next < to && metresAlong(ride, from, next.toDouble()) > tuning.stopRadius
    }

    /** How far [ride] runs from position [from] on to [to]; hops without both stops' coordinates count nothing. */
    private fun metresAlong(ride: TripLeg.Ride, from: Double, to: Double): Double {
        var metres = 0.0
        var k = floor(from).toInt().coerceAtLeast(0)
        while (k < ride.lastIndex && k < to) {
            val a = ride.stops[k].point
            val b = ride.stops[k + 1].point
            if (a != null && b != null) metres += (min(to, k + 1.0) - max(from, k.toDouble())) * distanceM(a, b)
            k++
        }
        return metres
    }

    /** Whether [point] is nearer the station the walk before ride [legIndex] goes to than the one it left. */
    private fun reachedAfterWalk(plan: TripPlan, legIndex: Int, point: GeoPoint): Boolean {
        val walk = plan.transferBefore(legIndex) ?: return true
        val to = walk.to.point ?: return true
        val from = walk.from.point ?: return true
        return distanceM(point, to) < distanceM(point, from)
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
                // Seen off the ride before, and still walking to this one when it left: the rider
                // can't be aboard, whatever the clock says.
                val walkedPast = departs != null && state.confirmedAt != null && state.walkEndsAt(plan)?.isAfter(departs) == true
                if (ride.isTimed && !fresh && departs != null && !now.isBefore(departs) && !walkedPast) {
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
     * "Siap-siap": as the train leaves the stop before the one to get off at, or, when that last hop
     * is long, about three minutes before reaching it. A train held at the stop before (seen there
     * by a fix) hasn't left; by the clock alone, it leaves as it gets there.
     */
    private fun prepareIfDue(
        ride: TripLeg.Ride,
        clock: RideClock,
        state: TripState,
        now: Instant,
        effects: MutableList<TripEffect>,
    ): TripState {
        if (prepareKey(state.legIndex) in state.firedAlerts) return state
        val before = (ride.lastIndex - 1).toDouble()
        val hopStart = clock.scheduledAt(before)
        val left = state.position > before || (
            state.position == before && state.source != PositionSource.CONFIRMED &&
                hopStart != null && !now.isBefore(hopStart.plusSeconds(state.clockOffsetS))
            )
        if (!left) return state
        val hopEnd = clock.scheduledAt(ride.lastIndex.toDouble())
        if (hopStart != null && hopEnd != null && Duration.between(hopStart, hopEnd) > LONG_HOP) {
            val atPosition = clock.scheduledAt(state.position)!!
            if (Duration.between(atPosition, hopEnd) > PREPARE_LEAD) return state
        }
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
        // Off by a tap or a fix: seen at the stop, unless a fix saw them get in already.
        val alighted = stopKey(state.legIndex, ride.lastIndex)
        val seen = if (estimated || alighted in state.stopTimes) state.stopTimes else state.stopTimes + (alighted to now.toEpochMilli())
        var next = state.copy(position = ride.lastIndex.toDouble(), stopTimes = seen)
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
            // Off when seen; by the clock, when the ride should have got in, not when that was noticed.
            walkingSince = (if (estimated) ride.arrivalAt?.plusSeconds(state.clockOffsetS) ?: now else now)
                .takeIf { plan.transferBefore(following) != null },
            sightedPosition = null,
            passingFrom = null,
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
        val atStop: Double,
        val corridor: Double,
        val accuracyGate: Float,
        val offRoute: Double,
        val missed: Double,
    ) {
        companion object {
            private fun rail(atStop: Double) = Tuning(RAIL_STOP_RADIUS_M, atStop, RAIL_CORRIDOR_M, RAIL_ACCURACY_GATE_M, RAIL_OFF_ROUTE_M, RAIL_MISSED_M)
            private val BUS = Tuning(BUS_STOP_RADIUS_M, BUS_AT_STOP_M, BUS_CORRIDOR_M, BUS_ACCURACY_GATE_M, BUS_OFF_ROUTE_M, BUS_MISSED_M)

            fun of(ride: TripLeg.Ride) = when {
                ride.isBus -> BUS
                else -> rail(longestTrainM(ride)?.let { it / 2 + RAIL_AT_STOP_SLACK_M } ?: RAIL_AT_STOP_M)
            }
        }
    }
}
