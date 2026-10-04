package id.shiorilabs.commute.feature.trip.presentation

import id.shiorilabs.commute.core.trip.PositionSource
import id.shiorilabs.commute.core.trip.TripPhase
import id.shiorilabs.commute.feature.trip.ActiveTrip
import kotlin.math.floor

enum class StopMark { PASSED, HERE, UPCOMING }

/**
 * How one ride's stops are drawn on the live screen.
 *
 * @property betweenAfter Set when the rider is out between two stops: the index of the one behind
 *   them, the marker going under it. Every stop is then passed or upcoming, none "here".
 */
data class RideMarks(val marks: List<StopMark>, val betweenAfter: Int? = null)

/** Where along the trip each stop stands, ride by ride, keyed by leg index. */
internal fun ActiveTrip.stopMarks(): Map<Int, RideMarks> = plan.rideIndices.associateWith { leg ->
    val stops = plan.ride(leg).stops.size
    when {
        state.phase == TripPhase.ARRIVED -> RideMarks(
            List(stops) { i -> if (leg == plan.rideIndices.last() && i == stops - 1) StopMark.HERE else StopMark.PASSED },
        )
        leg < state.legIndex -> RideMarks(List(stops) { StopMark.PASSED })
        leg > state.legIndex -> RideMarks(List(stops) { StopMark.UPCOMING })
        state.phase == TripPhase.WAITING_TO_BOARD -> RideMarks(
            List(stops) { i -> if (i == 0 && state.source == PositionSource.CONFIRMED) StopMark.HERE else StopMark.UPCOMING },
        )
        // Riding with nothing to place them: passed what was last seen, nothing claimed beyond.
        state.source == PositionSource.UNKNOWN -> {
            val passed = floor(state.position).toInt()
            RideMarks(List(stops) { i -> if (i < passed || (i == 0 && passed == 0)) StopMark.PASSED else StopMark.UPCOMING })
        }
        else -> {
            val behind = floor(state.position).toInt().coerceAtMost(stops - 1)
            val fraction = state.position - behind
            when {
                fraction < AT_STOP -> RideMarks(List(stops) { i -> markAt(i, behind) })
                fraction > 1 - AT_STOP -> RideMarks(List(stops) { i -> markAt(i, behind + 1) })
                else -> RideMarks(
                    List(stops) { i -> if (i <= behind) StopMark.PASSED else StopMark.UPCOMING },
                    betweenAfter = behind,
                )
            }
        }
    }
}

private fun markAt(i: Int, here: Int) = when {
    i < here -> StopMark.PASSED
    i == here -> StopMark.HERE
    else -> StopMark.UPCOMING
}

/** Within this share of a hop from a stop, the rider is at that stop. */
private const val AT_STOP = 0.15
