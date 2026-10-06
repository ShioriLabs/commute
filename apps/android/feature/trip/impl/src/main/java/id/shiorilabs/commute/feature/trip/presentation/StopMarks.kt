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
            // At a stop as the board above says it: the stop to get off at once there, a stop on
            // the way only where a fix has the train standing. Nearly there is still on the way, and
            // the clock only ever passes through.
            val at = when {
                behind == stops - 1 -> behind
                state.source == PositionSource.CONFIRMED && state.position == floor(state.position) -> behind
                else -> null
            }
            if (at != null) {
                RideMarks(List(stops) { i -> markAt(i, at) })
            } else {
                RideMarks(
                    List(stops) { i -> if (i <= behind) StopMark.PASSED else StopMark.UPCOMING },
                    betweenAfter = behind,
                )
            }
        }
    }
}

/** Whether the rider has got this far: the line up to a stop so marked is behind them. */
internal val StopMark.reached: Boolean get() = this != StopMark.UPCOMING

/** A line of a ride's timeline: one stop, or a run of stops folded into one tappable line. */
sealed interface TimelineRow {

    data class Stop(val index: Int) : TimelineRow

    data class Folded(val first: Int, val last: Int) : TimelineRow {
        val count: Int get() = last - first + 1
    }
}

/** A ride with more stops than this folds the ones that don't matter yet. */
const val TIMELINE_UNFOLDED_MAX = 7

/**
 * The rows of a ride with [count] stops: every one when it's short or [expanded]. Otherwise both
 * ends, the stop before getting off, and the stops around [focus] (where the rider is, or the stop
 * they're making for), each longer run between them folded into one row. A single stop is never
 * folded: the row saying so would take its room.
 */
internal fun timelineRows(count: Int, focus: Int?, expanded: Boolean): List<TimelineRow> {
    val last = count - 1
    if (expanded || count <= TIMELINE_UNFOLDED_MAX) return (0..last).map(TimelineRow::Stop)
    val keep = buildSet {
        add(0)
        add(last - 1)
        add(last)
        focus?.let { f -> addAll((f - 1..f + 2).filter { it in 0..last }) }
    }
    val rows = mutableListOf<TimelineRow>()
    var i = 0
    while (i <= last) {
        if (i in keep) {
            rows += TimelineRow.Stop(i)
            i++
            continue
        }
        var end = i
        while (end + 1 <= last && end + 1 !in keep) end++
        rows += if (end == i) TimelineRow.Stop(i) else TimelineRow.Folded(i, end)
        i = end + 1
    }
    return rows
}

private fun markAt(i: Int, here: Int) = when {
    i < here -> StopMark.PASSED
    i == here -> StopMark.HERE
    else -> StopMark.UPCOMING
}
