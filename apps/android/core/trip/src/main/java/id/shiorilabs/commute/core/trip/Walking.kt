package id.shiorilabs.commute.core.trip

import java.time.Duration
import java.time.Instant

/** A train a minute late is still worth running for; past that, look for the next. */
val CATCH_GRACE: Duration = Duration.ofMinutes(1)

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

/**
 * Added to any walk between stations for the stairs, gates and corridors the distance doesn't show:
 * 310 m from Sudirman to Dukuh Atas BSI took about nine minutes on 19 Oct, against four and a half
 * by distance alone.
 */
private const val TRANSFER_OVERHEAD_S = 180L

/** Short changes (a platform to the next) have fewer stairs: the overhead grows with the walk up to its full size. */
private const val OVERHEAD_S_PER_M = 1.2

private fun walkSeconds(walk: TripLeg.Transfer): Long =
    if (walk.distanceM <= 0) 0 else (walk.distanceM / WALK_M_PER_S).toLong() + minOf(TRANSFER_OVERHEAD_S, (walk.distanceM * OVERHEAD_S_PER_M).toLong())
