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
    return since.plusSeconds((walk.distanceM / WALK_M_PER_S).toLong())
}
