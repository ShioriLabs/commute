package id.shiorilabs.commute.wear

import id.shiorilabs.commute.core.trip.TripLeg
import id.shiorilabs.commute.core.trip.TripPhase
import id.shiorilabs.commute.core.trip.TripPlan
import id.shiorilabs.commute.core.trip.TripState
import id.shiorilabs.commute.core.trip.expectedAtStop
import id.shiorilabs.commute.core.trip.scheduledAtStop
import java.time.Duration
import java.time.Instant

/**
 * One of the trip's key moments, getting on or off a ride, as the watch lists them under the top in
 * the way a weather app lists its hours.
 */
data class Moment(
    val kind: Kind,
    /** Index into [TripPlan.legs] of the ride. */
    val legIndex: Int,
    val place: String,
    /** When it happens: expected, lateness and all, on the ride being followed; timetabled on the rest. */
    val at: Instant?,
    /** How many minutes past the timetable [at] is; never below nothing, as early isn't promised. */
    val lateMinutes: Int,
    /** Getting on only: the platform, where it's known. */
    val platform: String? = null,
    /** Getting on only: the walk to it from the ride before, across to another station. */
    val walkM: Int? = null,
    /** Getting on the next ride only: the trains after it, soonest first, as the plan knew them. */
    val later: List<Instant> = emptyList(),
    val status: Status,
) {

    enum class Kind { BOARD, ALIGHT }

    enum class Status { PASSED, NEXT, AHEAD }
}

/** Every ride's getting on and getting off, in order, each passed, next or still ahead. */
fun tripMoments(plan: TripPlan, state: TripState): List<Moment> {
    val current = plan.rideIndices.indexOf(state.legIndex)
    return plan.rideIndices.flatMapIndexed { r, leg ->
        val ride = plan.ride(leg)
        val (board, alight) = when {
            r < current -> Moment.Status.PASSED to Moment.Status.PASSED
            r > current -> Moment.Status.AHEAD to Moment.Status.AHEAD
            else -> when (state.phase) {
                TripPhase.WAITING_TO_BOARD -> Moment.Status.NEXT to Moment.Status.AHEAD
                TripPhase.RIDING -> Moment.Status.PASSED to Moment.Status.NEXT
                TripPhase.ARRIVED -> Moment.Status.PASSED to Moment.Status.PASSED
            }
        }
        listOf(
            moment(plan, state, leg, ride, 0, Moment.Kind.BOARD, board).copy(
                platform = ride.platformCode,
                walkM = plan.transferBefore(leg)?.distanceM,
                later = ride.nextDepartures.takeIf { board == Moment.Status.NEXT }.orEmpty(),
            ),
            moment(plan, state, leg, ride, ride.lastIndex, Moment.Kind.ALIGHT, alight),
        )
    }
}

private fun moment(
    plan: TripPlan,
    state: TripState,
    leg: Int,
    ride: TripLeg.Ride,
    stopIndex: Int,
    kind: Moment.Kind,
    status: Moment.Status,
): Moment {
    val scheduled = plan.scheduledAtStop(leg, stopIndex)
    // Lateness is the followed ride's alone: it says nothing about a different train.
    val at = (if (leg == state.legIndex) state.expectedAtStop(plan, stopIndex) else null) ?: scheduled
    val late = if (scheduled != null && at != null) ((Duration.between(scheduled, at).seconds + 30) / 60).toInt() else 0
    return Moment(
        kind = kind,
        legIndex = leg,
        place = ride.stops[stopIndex].name,
        at = at,
        lateMinutes = late.coerceAtLeast(0),
        status = status,
    )
}
