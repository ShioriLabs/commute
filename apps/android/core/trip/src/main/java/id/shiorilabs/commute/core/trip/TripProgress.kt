package id.shiorilabs.commute.core.trip

import kotlin.math.floor

/** What the rider should do next: the line every surface (Live Update, screen, watch) leads with. */
sealed interface NextAction {

    /** Waiting for the first ride. */
    data class Board(val legIndex: Int) : NextAction

    /** Off one ride and onto the next; [transfer] when there is a walk between them. */
    data class Change(val legIndex: Int, val transfer: TripLeg.Transfer?) : NextAction

    /** On a ride, [stopsLeft] stops (the alighting one included) from getting off. */
    data class RideTo(val legIndex: Int, val stopsLeft: Int) : NextAction

    /** At the alighting stop; [thenLegIndex] is the ride that follows, if any. */
    data class AlightNow(val legIndex: Int, val thenLegIndex: Int?) : NextAction

    data object Arrived : NextAction
}

/**
 * The trip at a glance.
 *
 * @property fraction How far along the whole trip, 0 to 1, by stops ridden: the bar's tracker.
 * @property rideFractions Each ride's share of [fraction]'s whole, in order: the bar's segments.
 */
data class TripProgress(
    val fraction: Double,
    val rideFractions: List<Double>,
    val next: NextAction,
    val source: PositionSource,
)

fun TripState.progress(plan: TripPlan): TripProgress {
    val rides = plan.rideIndices
    val hops = rides.map { plan.ride(it).lastIndex.toDouble() }
    val total = hops.sum()
    val current = rides.indexOf(legIndex)
    val done = when (phase) {
        TripPhase.ARRIVED -> total
        TripPhase.WAITING_TO_BOARD -> hops.take(current).sum()
        TripPhase.RIDING -> hops.take(current).sum() + position.coerceIn(0.0, hops[current])
    }
    val ride = plan.ride(legIndex)
    val next = when (phase) {
        TripPhase.ARRIVED -> NextAction.Arrived
        TripPhase.WAITING_TO_BOARD -> if (current == 0) {
            NextAction.Board(legIndex)
        } else {
            NextAction.Change(legIndex, plan.transferBefore(legIndex))
        }
        TripPhase.RIDING -> {
            val left = ride.lastIndex - floor(position).toInt()
            if (left <= 0) NextAction.AlightNow(legIndex, plan.nextRideAfter(legIndex)) else NextAction.RideTo(legIndex, left)
        }
    }
    return TripProgress(
        fraction = if (total == 0.0) 0.0 else (done / total).coerceIn(0.0, 1.0),
        rideFractions = hops.map { it / total },
        next = next,
        source = if (phase == TripPhase.ARRIVED) PositionSource.CONFIRMED else source,
    )
}

/**
 * When the current ride should reach its alighting stop, lateness included; `null` when it has no
 * timetable or the trip has arrived.
 */
fun TripState.expectedAlightingAt(plan: TripPlan): java.time.Instant? {
    if (phase == TripPhase.ARRIVED) return null
    val ride = plan.ride(legIndex).takeIf { it.isTimed } ?: return null
    return ride.arrivalAt?.plusSeconds(clockOffsetS)
}

/** When the current ride should leave its boarding stop, lateness included; `null` untimed. */
fun TripState.expectedDepartureAt(plan: TripPlan): java.time.Instant? {
    val ride = plan.ride(legIndex).takeIf { it.isTimed } ?: return null
    return ride.departureAt?.plusSeconds(clockOffsetS)
}

/**
 * When the current ride should reach its stop [stopIndex], lateness included: interpolated between
 * the ride's two timetabled ends. `null` on an untimed ride or once arrived.
 */
fun TripState.expectedAtStop(plan: TripPlan, stopIndex: Int): java.time.Instant? =
    expectedAt(plan, stopIndex.toDouble())

/** As [expectedAtStop], for any point along the ride: `2.5` is halfway between its third and fourth stops. */
fun TripState.expectedAt(plan: TripPlan, position: Double): java.time.Instant? {
    if (phase == TripPhase.ARRIVED) return null
    val ride = plan.ride(legIndex).takeIf { it.isTimed } ?: return null
    return RideClock(ride).scheduledAt(position)?.plusSeconds(clockOffsetS)
}
