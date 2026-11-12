package id.shiorilabs.commute.core.trip

import java.time.Duration
import java.time.Instant
import kotlin.math.ceil
import kotlin.math.max

/*
 * Boarding a late train that was due before the planned one.
 *
 * Trip mode follows the train the plan names, so a rider who steps onto an earlier one still at the
 * platform reads as the planned train running early. On 30 Oct, started at Cakung 09.23.42 for the
 * 09.30, the rider rode the 09.22 out at 09.25.20 and the board said "−5". On 5 Nov, on the CUK
 * platform at 09.39 for the 09.45, they rode the 09.35 out at 09.39.50 and the board sat at its −300 s
 * floor all the way to Manggarai. The API now names the trains due shortly before the caught one
 * (`earlierDepartures`), so the train can be told, and every ride after it re-timed, with no network.
 */

/**
 * A train doesn't leave early; it waits out a padded timetable. Seen pulling out this far or more
 * before the plan's train is due, it is another train.
 */
val TRAIN_LEFT_EARLY: Duration = Duration.ofMinutes(2)

/** How far ahead of a train's time a departure read off the first fix out may be and still be that train: the projection wanders. */
private val DEPARTED_SLACK: Duration = Duration.ofSeconds(30)

/** As the planner, for a plan from before rides carried the API's change allowance. */
private const val FALLBACK_MIN_CHANGE_S = 60L
private const val FALLBACK_WALK_M_PER_S = 1.2

/** As many later trains as a trip keeps from the API. */
private const val NEXT_DEPARTURES_KEPT = 4

/**
 * When this ride's train left its first stop, read from a fix at [position] at [seenAt]: the plan's
 * departure moved by however far the fix ran from the timetable there. Unlike the engine's clock
 * offset this is not floored at five minutes early, which is the whole point. `null` untimed.
 */
fun TripLeg.Ride.leftAt(position: Double, seenAt: Instant): Instant? {
    val planned = departureAt ?: return null
    val due = RideClock(this).scheduledAt(position) ?: return null
    return planned.plus(Duration.between(due, seenAt))
}

/**
 * The plan with ride [legIndex] moved onto the earlier train that left at [leftAt], and the rides
 * after it re-timed onto the first of their own trains that connects from the earlier arrival.
 *
 * `null` when it left less than [TRAIN_LEFT_EARLY] before the plan's train (that may well be it,
 * a little off the clock), or no train listed before it was due by then. Of those that were, the
 * latest: the one least late is the likeliest.
 *
 * A following ride only ever moves earlier, since an earlier arrival still makes its planned train;
 * the moves stop at the first ride that stays, or one with no timetable.
 */
fun TripPlan.ontoEarlierTrain(legIndex: Int, leftAt: Instant): TripPlan? {
    val ride = legs.getOrNull(legIndex) as? TripLeg.Ride ?: return null
    val planned = ride.departureAt ?: return null
    if (Duration.between(leftAt, planned) < TRAIN_LEFT_EARLY) return null
    val took = ride.earlierDepartures
        .filter { it.departureAt.isBefore(planned) && !it.departureAt.isAfter(leftAt.plus(DEPARTED_SLACK)) }
        .maxByOrNull { it.departureAt }
        ?: return null

    val moved = legs.toMutableList()
    var before = ride.onto(took)
    moved[legIndex] = before
    var beforeIndex = legIndex
    for (index in rideIndices.filter { it > legIndex }) {
        val arrival = before.arrivalAt ?: break
        val onward = ride(index)
        val departs = onward.departureAt ?: break
        val change = changeS(beforeIndex, index)
        val catchable = onward.earlierDepartures
            .filter { it.departureAt.isBefore(departs) }
            .firstOrNull { it.connectsFrom(arrival, change) }
            ?: break
        before = onward.onto(catchable)
        moved[index] = before
        beforeIndex = index
    }
    return TripPlan(moved)
}

/**
 * This ride on [train] instead, an earlier one: its times shifted offline (the stops are the same)
 * and its arrival the train's own where the API gave it. Its line stays: the rider's route doesn't
 * change, only which run of it; the headsign is the train's, since an earlier run may turn short.
 */
private fun TripLeg.Ride.onto(train: TripDeparture): TripLeg.Ride {
    val planned = departureAt!!
    val delta = Duration.between(planned, train.departureAt)
    val between = earlierDepartures.filter { it.departureAt.isAfter(train.departureAt) }.map { it.departureAt }
    return copy(
        departureAt = train.departureAt,
        arrivalAt = train.arrivalAt ?: arrivalAt?.plus(delta),
        stops = stops.map { it.copy(scheduledAt = it.scheduledAt?.plus(delta)) },
        tripId = train.tripId,
        headsign = train.headsign ?: headsign,
        earlierDepartures = earlierDepartures.filter { it.departureAt.isBefore(train.departureAt) },
        // The trains it skipped, the planned one among them, are the later ones now.
        nextDepartures = (between + planned + nextDepartures).distinct().sorted().take(NEXT_DEPARTURES_KEPT),
    )
}

/** Whether a rider landing at [arrival] makes this train: by its crossing cutoff where it has one, else by the change. */
private fun TripDeparture.connectsFrom(arrival: Instant, changeS: Long): Boolean =
    connectBy?.let { !arrival.isAfter(it) } ?: !departureAt.isBefore(arrival.plusSeconds(changeS))

/** The change from ride [from] into ride [to]: the API's allowance, or a minute plus the walk at average pace. */
private fun TripPlan.changeS(from: Int, to: Int): Long {
    ride(to).minChangeS?.let { return it.toLong() }
    val walkM = (from + 1 until to).sumOf { (legs[it] as? TripLeg.Transfer)?.distanceM ?: 0 }
    return max(FALLBACK_MIN_CHANGE_S, ceil(walkM / FALLBACK_WALK_M_PER_S).toLong())
}
