package id.shiorilabs.commute.core.trip

import java.time.Instant

/** An easy pace through a station's corridors and stairs, crowds and all. */
private const val WALK_M_PER_S = 1.1

/**
 * When the walk to the station the current ride leaves from should be done: from getting off the
 * ride before, at an easy pace. `null` when the rider isn't walking (no walk before this ride, or a
 * fix has already found them there).
 */
fun TripState.walkEndsAt(plan: TripPlan): Instant? {
    val since = walkingSince ?: return null
    if (phase != TripPhase.WAITING_TO_BOARD) return null
    val walk = plan.transferBefore(legIndex) ?: return null
    return since.plusSeconds(walkSeconds(walk))
}

/**
 * Riding on, when the rider can be at the next ride's first stop, with that ride's leg index: the
 * current ride's arrival, its lateness included, then the walk between at an easy pace. `null` when
 * not riding, on the last ride, or on a ride without a timetable.
 */
fun TripState.nextRideReadyAt(plan: TripPlan): Pair<Int, Instant>? {
    if (phase != TripPhase.RIDING) return null
    val next = plan.nextRideAfter(legIndex) ?: return null
    val alighting = expectedAlightingAt(plan) ?: return null
    return next to alighting.plusSeconds(plan.transferBefore(next)?.let(::walkSeconds) ?: 0)
}

private fun walkSeconds(walk: TripLeg.Transfer): Long = (walk.distanceM / WALK_M_PER_S).toLong()
