package id.shiorilabs.commute.core.trip

import id.shiorilabs.commute.core.geo.GeoPoint
import id.shiorilabs.commute.core.geo.Projection
import id.shiorilabs.commute.core.geo.distanceM
import id.shiorilabs.commute.core.geo.project
import id.shiorilabs.commute.core.geo.projectOnPath
import java.time.Duration
import java.time.Instant
import kotlin.math.ceil
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

    /** A bus's "siap-siap" comes within this much road of the halte: [busPrepareM]. */
    private const val BUS_PREPARE_MIN_M = 250.0
    private const val BUS_PREPARE_MAX_M = 900.0
    private val BUS_PREPARE_LEAD: Duration = Duration.ofSeconds(90)

    /** How long a bus must keep a speed for "siap-siap" to look ahead by it. */
    private val BUS_SPEED_HELD: Duration = Duration.ofSeconds(30)

    /** A last hop shorter than this is near as soon as the bus is out of the halte before. */
    private const val BUS_SHORT_HOP_M = 400.0

    /**
     * Slower than this by a station, by the satellites' own speed, the train is stopping there; faster,
     * it is still rolling in or already pulling out. About 20 km/h: braking at a KRL's 0.8–1 m/s², five
     * to ten seconds from standing, so "Sekarang di" lands just before the train does.
     */
    private const val STOPPING_M_PER_S = 6.0

    /** How far short of a station a train still rolling in through its radius is put. */
    private const val ROLLING_IN = 0.01

    /** How far out of a stop a train felt leaving it is put: about as far as it's gone by the time that's sure. */
    private const val DEPARTED_M = 10.0

    /** ...or this much of the hop, when how long it is isn't known. */
    private const val DEPARTED_STEP = 0.001

    /** How many stops ahead a fix may place the rider: far enough for a long gap, not a loop's far side. */
    private const val LOOKAHEAD_STOPS = 6

    /** A fix this far behind the confirmed point is jitter, and still counts as "on the route here". */
    private const val JITTER = 0.25

    /** Past this along the first hop, and seen getting there at [RIDING_M_PER_S], a rider still walking from the last ride is on the vehicle. */
    private const val BOARDED_AT = 0.3

    /**
     * Fixes in a row that must have a waiting rider past the platform at a vehicle's pace before
     * they're aboard. At Sudirman one fix leapt 200 m north and the next came back past the platform
     * at 9.9 m/s: the board had a train 279 s early sitting there for six minutes before the real one
     * left. One that has them at a stop further on will do: no fix wanders a whole hop from the platform.
     */
    private const val BOARDING_FIXES = 2

    /** Faster than anyone walks (about 7 km/h); slower than a train pulling out or a bus in traffic. */
    private const val RIDING_M_PER_S = 2.0

    /** Slower than this, by the satellites, the train is standing still. */
    private const val STANDING_M_PER_S = 1.0

    /** A train brakes into a stop at about this rate; and the doors take [DOORS_OPEN] after it halts. */
    private const val BRAKING_M_PER_S2 = 1.0
    private val DOORS_OPEN: Duration = Duration.ofSeconds(10)

    /** Faster than a rider walks (1.2 to 1.5 m/s): a fix at this speed is a train still rolling. */
    private const val ROLLING_M_PER_S = 3.0

    /** A fix this recent says how fast the train is going as it's left. */
    private val ROLLING_FIX_FRESH: Duration = Duration.ofSeconds(10)

    /**
     * Fixes in a row at [RIDING_M_PER_S] or more, after standing at a stop, that take a train out of
     * it while still slower than [STOPPING_M_PER_S]: one could be a jolt; two is the train leaving.
     */
    private const val PULLING_OUT_FIXES = 2

    /**
     * How far on along the route fixes must carry a bus past a halte it was never seen near before
     * they're believed. A hop without a shape is a straight line and roads aren't: L13E reaches Tegal Mampang down
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

    /**
     * How long before a ride is due, and after, fixes come every few seconds while waiting for it.
     * After: KRL ran a minute and a half to three and a half behind on 13–15 Oct; a train later than
     * that is usually swapped for the next by then, which brings its own window.
     */
    private val DEPARTING_LEAD: Duration = Duration.ofMinutes(2)
    private val DEPARTING_TAIL: Duration = Duration.ofMinutes(5)

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
            is TripEvent.Departed -> departed(plan, state, event)
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
        val tracked = state.copy(
            stoodAt = pullOut.stoodAt,
            pullingOutFixes = pullOut.fixes,
            pullingOutSpeed = pullOut.speed,
            recentSpeeds = (state.recentSpeeds + SpeedSample(fix.at.toEpochMilli(), fix.speedMps ?: 0f))
                .filter { fix.at.toEpochMilli() - it.atMs <= BUS_SPEED_HELD.toMillis() },
        )
        val candidate = pullOut.leftTo ?: located
        if (candidate != null && candidate >= state.confirmedPosition - JITTER) {
            // Seen near the line but not aboard: the fix says where they are, not how far they've
            // come. A walk ends only at the station it goes to, as a change can run beside the
            // next line out of the station it left.
            val boarding = state.phase == TripPhase.WAITING_TO_BOARD && boards(ride, state, candidate, fix, tuning)
            val boardingFixes = if (boarding) state.boardingFixes + 1 else 0
            val boarded = boarding && (boardingFixes >= BOARDING_FIXES || candidate >= 1.0)
            if (state.phase == TripPhase.WAITING_TO_BOARD && !boarded) {
                val walked = state.walkingSince != null && reachedAfterWalk(plan, state.legIndex, fix.point, tuning)
                return tracked.copy(
                    boardingFixes = boardingFixes,
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
                    // Not past it yet, but plainly still aboard: the board stays where it was.
                    return tracked.copy(passingFrom = from, confirmedAt = fix.at, hasLocation = true)
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
            // when it left; at the stop to get off at, the first, when it got in. Not one still
            // reading it there once it's been felt leaving: that's when it left.
            val stop = candidate.toInt().takeIf { candidate == floor(candidate) && candidate >= state.confirmedPosition }
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
                boardingFixes = 0,
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
        // A bus's road bends away from its straight hops (L13E runs 350 m off one down Mampang), and
        // an untimed ride has no clock to fall back on: near the route, it's still where it was. A
        // train's would hand over to the timetable, which knows more than a held position.
        if (ride.isBus) return tracked.copy(confirmedAt = fix.at, hasLocation = true)
        return tracked.copy(hasLocation = true)
    }

    /**
     * The stop the train stands at, on the way, for the motion sensors to feel it leave
     * ([TripEvent.Departed]): a fresh fix there read it standing, on rails. Not while it may still be
     * braking in, whose braking read against the standing after it is a pull; not a bus, which stops
     * and starts at every light; not the stop the ride starts from, which is boarding's.
     */
    fun awaitingDeparture(plan: TripPlan, state: TripState, now: Instant): StopAt? {
        if (state.phase != TripPhase.RIDING) return null
        val ride = plan.ride(state.legIndex)
        if (ride.isBus) return null
        val at = state.confirmedPosition
        if (at != floor(at)) return null
        val stop = at.toInt()
        if (stop <= 0 || stop >= ride.lastIndex) return null
        if (state.confirmedAt?.let { Duration.between(it, now) < STALE } != true) return null
        if (state.stoodAt != stopKey(state.legIndex, stop)) return null
        return StopAt(state.legIndex, stop)
    }

    /**
     * Felt leaving the stop it stood at: just out of it, as late as it was setting off. Seconds before
     * a fix could say so: every half minute, and frozen at standing under a roof. One that comes when
     * the train isn't waiting there any more changes nothing.
     */
    private fun departed(plan: TripPlan, state: TripState, event: TripEvent.Departed): TripState {
        if (awaitingDeparture(plan, state, event.at) != StopAt(event.legIndex, event.stopIndex)) return state
        val ride = plan.ride(state.legIndex)
        val stop = event.stopIndex
        val out = ride.hopLengthM(stop)?.takeIf { it > 0 }?.let { min(DEPARTED_M / it, ROLLING_IN) } ?: DEPARTED_STEP
        val offset = RideClock(ride).scheduledAt(stop.toDouble())
            ?.let { Duration.between(it, event.at).seconds.coerceIn(MAX_EARLY_S, MAX_LATE_S) }
            ?: state.clockOffsetS
        return state.copy(
            confirmedPosition = stop + out,
            // A fix reading it standing can land a moment after the pull began.
            confirmedAt = state.confirmedAt?.let { maxOf(it, event.at) } ?: event.at,
            clockOffsetS = offset,
            stopTimes = state.stopTimes + (stopKey(state.legIndex, stop) to event.at.toEpochMilli()),
            stoodAt = null,
            pullingOutFixes = 0,
            pullingOutSpeed = null,
        )
    }

    /** What [pullOut] makes of a fix: the stop being watched, the fixes counted, where it left to. */
    private class PullOut(val stoodAt: String?, val fixes: Int, val leftTo: Double?, val speed: Float? = null)

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
        val speed = fix.speedMps ?: return PullOut(watching, if (watching == null) 0 else state.pullingOutFixes, null, state.pullingOutSpeed.takeIf { watching != null })
        if (speed < STANDING_M_PER_S) return PullOut(key, 0, null)
        if (watching == null || speed < RIDING_M_PER_S) return PullOut(watching, 0, null)
        // Slower than the last, it's still braking in: a train pulling out gathers speed. Setiabudi's
        // MRT read 3.6, 3.0, 2.9 m/s coming in underground after one stray 0.6, and "siap-siap" came
        // as the doors opened.
        val slowing = state.pullingOutSpeed?.let { speed < it } == true
        val fixes = if (slowing) 0 else state.pullingOutFixes + 1
        if (fixes < PULLING_OUT_FIXES) return PullOut(key, fixes, null, speed)
        val along = alongHops(ride, stop, min(ride.lastIndex, stop + LOOKAHEAD_STOPS), fix.point, tuning)
        return PullOut(key, fixes, along?.takeIf { it > stop }, speed)
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
        return alongHops(ride, start, end, point, tuning)?.let { reachedAlongShape(ride, it, tuning) }
    }

    /**
     * [along], or the stop to get off at once [along] is within [Tuning.atStop] of it along the last
     * hop's shape. A shape ends where the line stops at the station, which needn't be its point:
     * 6A stops 91 m short of Bundaran HI Astra's, and sat there 35 s before "turun" came.
     */
    private fun reachedAlongShape(ride: TripLeg.Ride, along: Double, tuning: Tuning): Double {
        val last = ride.lastIndex - 1
        if (along < last || ride.hopPaths[last] == null) return along
        val left = (ride.lastIndex - along) * (ride.hopLengthM(last) ?: return along)
        return if (left <= tuning.atStop) ride.lastIndex.toDouble() else along
    }

    /** [point] projected onto the nearest hop from stop [start] to stop [end] it runs alongside, along its shape where it has one. */
    private fun alongHops(ride: TripLeg.Ride, start: Int, end: Int, point: GeoPoint, tuning: Tuning): Double? {
        var bestHop: Double? = null
        var bestOffTrack = Double.MAX_VALUE
        for (k in start until end) {
            val projection = hop(ride, k, point) ?: continue
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
     * Whether the rider waiting for their ride was last seen at its platform: standing there, or on a
     * train still pulling along it (only one at a train's pace is put along the hop that near).
     */
    fun seenAtPlatform(plan: TripPlan, state: TripState): Boolean {
        val sighted = state.sightedPosition ?: return false
        val ride = plan.ride(state.legIndex)
        return metresAlong(ride, 0.0, sighted) <= Tuning.of(ride).atStop
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
     *
     * After one such fix (now the sighting), the next need only keep on at a vehicle's pace by the
     * satellites, not behind it: a second a train out of Setiabudi covers less than the fixes' error.
     * Without a speed, it still has to have come on from it.
     */
    private fun boards(ride: TripLeg.Ride, state: TripState, candidate: Double, fix: TripEvent.Fix, tuning: Tuning): Boolean {
        val pastPlatform = if (state.walkingSince != null) candidate >= BOARDED_AT else metresAlong(ride, 0.0, candidate) > tuning.atStop
        if (!pastPlatform) return false
        if (fix.speedMps != null && fix.speedMps < RIDING_M_PER_S) return false
        val from = state.sightedPosition ?: return false
        if (state.boardingFixes > 0 && fix.speedMps != null) return candidate >= from
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

    /**
     * [point] projected onto hop [k] of [ride]: onto the hop's real shape when the plan carries one,
     * else the straight line between its stops; `null` when it has neither.
     */
    private fun hop(ride: TripLeg.Ride, k: Int, point: GeoPoint): Projection? {
        ride.hopPaths[k]?.let { return projectOnPath(point, it) }
        val a = ride.stops[k].point ?: return null
        val b = ride.stops[k + 1].point ?: return null
        return project(point, a, b)
    }

    /** How far [ride] runs from position [from] on to [to]; hops without both stops' coordinates or a shape count nothing. */
    private fun metresAlong(ride: TripLeg.Ride, from: Double, to: Double): Double {
        var metres = 0.0
        var k = floor(from).toInt().coerceAtLeast(0)
        while (k < ride.lastIndex && k < to) {
            ride.hopLengthM(k)?.let { metres += (min(to, k + 1.0) - max(from, k.toDouble())) * it }
            k++
        }
        return metres
    }

    /**
     * Whether [point] is at the station the walk before ride [legIndex] goes to: within a stopped
     * train's reach of it, and nearer it than the one it left. Merely nearer isn't enough: off the
     * Commuter Line at Sudirman's east end, a rider still on the KRL side was 210 m from Sudirman
     * and 209 m from LRT Dukuh Atas, three minutes before reaching its platform.
     */
    private fun reachedAfterWalk(plan: TripPlan, legIndex: Int, point: GeoPoint, tuning: Tuning): Boolean {
        val walk = plan.transferBefore(legIndex) ?: return true
        val to = walk.to.point ?: return true
        val from = walk.from.point ?: return true
        val distance = distanceM(point, to)
        return distance <= tuning.atStop && distance < distanceM(point, from)
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
        for (i in ride.stops.indices) {
            ride.stops[i].point?.let { best = min(best, distanceM(point, it)) }
            if (i < ride.lastIndex) hop(ride, i, point)?.let { best = min(best, it.offTrackM) }
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
            val offset = Duration.ofSeconds(state.lateS)

            if (state.phase == TripPhase.WAITING_TO_BOARD) {
                val departs = ride.departureAt?.plus(offset)
                // Seen off the ride before, and still walking to this one when it left: the rider
                // can't be aboard, whatever the clock says. Whether it's lost is the controller's call.
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
            // Where a train running early would be if it kept its lead: "siap-siap" goes by that,
            // better a minute early than after the doors have shut.
            val ahead = if (fresh) position else clock.positionAt(now.minusSeconds(state.clockOffsetS))?.let { max(position, it) } ?: position

            // Reached the alighting stop already (a long sleep, a sparse fix): too late for
            // "siap-siap", which is skipped below rather than sent after the fact.
            if (position < ride.lastIndex) state = prepareIfDue(ride, clock, state, ahead, now, effects)

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

        val mode = locationModeFor(plan, state, now)
        if (mode != state.locationMode) {
            effects += TripEffect.SetLocationMode(mode)
            state = state.copy(locationMode = mode)
        }
        return TripStep(state, effects, nextWake(plan, state, now))
    }

    /**
     * "Siap-siap": as the train leaves the stop before the one to get off at, or, when that last hop
     * is long, about three minutes before reaching it. A train held at the stop before (seen there
     * by a fix) hasn't left; by the clock alone, it leaves as it gets there. [position] is where the
     * train is taken to be for it: a train running early, unseen, still on its lead.
     *
     * A bus, once out of the halte before, waits for the halte to be near by road ([busPrepareM]):
     * on 15 Oct a jammed 9C took 24 minutes over Ciliwung to Cawang's last 915 m. A last hop under
     * [BUS_SHORT_HOP_M] is near as soon as the bus is out of the halte before.
     */
    private fun prepareIfDue(
        ride: TripLeg.Ride,
        clock: RideClock,
        state: TripState,
        position: Double,
        now: Instant,
        effects: MutableList<TripEffect>,
    ): TripState {
        if (prepareKey(state.legIndex) in state.firedAlerts) return state
        val before = (ride.lastIndex - 1).toDouble()
        val hopStart = clock.scheduledAt(before)
        val left = position > before || (
            position == before && state.source != PositionSource.CONFIRMED &&
                hopStart != null && !now.isBefore(hopStart.plusSeconds(state.clockOffsetS))
            )
        if (!left) return state
        if (ride.isBus) {
            val last = ride.lastIndex.toDouble()
            val shortHop = metresAlong(ride, before, last) < BUS_SHORT_HOP_M
            if (!shortHop && metresAlong(ride, position, last) > busPrepareM(state.recentSpeeds)) return state
            return fire(state, AlertKind.PREPARE, estimated = state.source != PositionSource.CONFIRMED, effects) ?: state
        }
        val hopEnd = clock.scheduledAt(ride.lastIndex.toDouble())
        if (hopStart != null && hopEnd != null && Duration.between(hopStart, hopEnd) > LONG_HOP) {
            val atPosition = clock.scheduledAt(position)!!
            if (Duration.between(atPosition, hopEnd) > PREPARE_LEAD) return state
        }
        return fire(state, AlertKind.PREPARE, estimated = state.source != PositionSource.CONFIRMED, effects) ?: state
    }

    /**
     * How near the halte a bus's "siap-siap" comes: [BUS_PREPARE_LEAD] out at the slowest speed the
     * satellites read over the last [BUS_SPEED_HELD], enough for a rider dozing on the elevated
     * busway, but never nearer than [BUS_PREPARE_MIN_M] (under Cawang's flyovers no usable fix came
     * within 180 m) nor further than [BUS_PREPARE_MAX_M]. Held, not last: leaving Ciliwung at 10 m/s
     * for 25 s, the 9C read 90 s out 24 minutes before it got there. A fix without a speed counts
     * as standing.
     */
    private fun busPrepareM(recentSpeeds: List<SpeedSample>): Double {
        val held = recentSpeeds.minOfOrNull { it.mps } ?: 0f
        return (held.toDouble() * BUS_PREPARE_LEAD.seconds).coerceIn(BUS_PREPARE_MIN_M, BUS_PREPARE_MAX_M)
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
            walkingSince = (if (estimated) ride.arrivalAt?.plusSeconds(state.lateS) ?: now else now.plus(stillRolling(state, now)))
                .takeIf { plan.transferBefore(following) != null },
            sightedPosition = null,
            boardingFixes = 0,
            passingFrom = null,
        )
    }

    /**
     * How long until the train that a fix has just put at the stop is stopped and its doors are open:
     * the walk can't start before. Sudirman's fix on 19 Oct read 5.35 m/s. Nothing when the last fix is
     * old (a tap, a long gap) or the train was standing.
     */
    private fun stillRolling(state: TripState, now: Instant): Duration {
        val last = state.recentSpeeds.lastOrNull() ?: return Duration.ZERO
        if (last.mps < ROLLING_M_PER_S || now.toEpochMilli() - last.atMs > ROLLING_FIX_FRESH.toMillis()) return Duration.ZERO
        return Duration.ofSeconds(ceil(last.mps / BRAKING_M_PER_S2).toLong()).plus(DOORS_OPEN)
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

    /**
     * Fixes every few seconds where a half-minute gap costs most: getting on, and getting off. Getting
     * on is from [DEPARTING_LEAD] before the ride is due until [DEPARTING_TAIL] after (a later train
     * swapped in moves it on), and whenever a fix has seen it pulling out: on 15 Oct the fix that
     * boarded came 30 s after the one that saw Setiabudi's late LRT leave.
     */
    private fun locationModeFor(plan: TripPlan, state: TripState, now: Instant): TripLocationMode = when {
        !state.hasLocation || state.phase == TripPhase.ARRIVED -> TripLocationMode.OFF
        state.phase == TripPhase.RIDING && state.position >= plan.ride(state.legIndex).lastIndex - 2 -> TripLocationMode.PRECISE
        state.phase == TripPhase.WAITING_TO_BOARD && (state.boardingFixes > 0 || departing(plan, state, now)) -> TripLocationMode.PRECISE
        else -> TripLocationMode.BALANCED
    }

    /** Whether the ride being waited for is about due to leave, or left only just. */
    private fun departing(plan: TripPlan, state: TripState, now: Instant): Boolean {
        val departs = plan.ride(state.legIndex).departureAt?.plusSeconds(state.lateS) ?: return false
        return !now.isBefore(departs.minus(DEPARTING_LEAD)) && now.isBefore(departs.plus(DEPARTING_TAIL))
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
            val offset = Duration.ofSeconds(state.lateS)
            // "Siap-siap" keeps to an early train's lead ([prepareIfDue]).
            val lead = Duration.ofSeconds(state.clockOffsetS)
            if (ride.isTimed) {
                when (state.phase) {
                    TripPhase.WAITING_TO_BOARD -> {
                        candidates += ride.departureAt!!.plus(offset)
                        candidates += ride.departureAt.plus(offset).minus(DEPARTING_LEAD)
                    }
                    else -> {
                        val nextStop = floor(state.position).toInt() + 1
                        if (nextStop <= ride.lastIndex) clock.scheduledAt(nextStop.toDouble())?.let { candidates += it.plus(offset) }
                        clock.scheduledAt((ride.lastIndex - 1).toDouble())?.let { candidates += it.plus(lead) }
                        val arrives = ride.arrivalAt!!.plus(offset)
                        candidates += ride.arrivalAt.plus(lead).minus(PREPARE_LEAD)
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
