package id.shiorilabs.commute.core.trip

import java.time.Instant

/**
 * What the trip says right now, before it is put into words: the line the Live Update, the alerts,
 * the live screen and the watch all lead with. Lines are keys (`KCI:C`), resolved to names by
 * whoever renders.
 */
sealed interface Headline {

    /** Waiting for the first ride. */
    data class Board(val ride: TripLeg.Ride, val departsAt: Instant?) : Headline

    /** Changing onto [ride]; [walk] when the change crosses to another station. */
    data class Change(val ride: TripLeg.Ride, val walk: TripLeg.Transfer?, val departsAt: Instant?) : Headline

    /** On [ride], [stopsLeft] stops from getting off. */
    data class RideTo(val ride: TripLeg.Ride, val stopsLeft: Int, val alightsAt: Instant?) : Headline

    /** At [ride]'s alighting stop; [then] is the next ride, if any. */
    data class AlightNow(val ride: TripLeg.Ride, val then: TripLeg.Ride?) : Headline

    data class Arrived(val destination: String) : Headline
}

fun TripState.headline(plan: TripPlan): Headline = when (val next = progress(plan).next) {
    is NextAction.Board -> Headline.Board(plan.ride(next.legIndex), expectedDepartureAt(plan))
    is NextAction.Change -> Headline.Change(plan.ride(next.legIndex), next.transfer, expectedDepartureAt(plan))
    is NextAction.RideTo -> Headline.RideTo(plan.ride(next.legIndex), next.stopsLeft, expectedAlightingAt(plan))
    is NextAction.AlightNow -> Headline.AlightNow(plan.ride(next.legIndex), next.thenLegIndex?.let(plan::ride))
    NextAction.Arrived -> Headline.Arrived(plan.destination.name)
}

/** Whole minutes from [now] to [at], at least one: "sekitar 2 menit lagi". */
fun minutesUntil(now: Instant, at: Instant): Int =
    ((at.toEpochMilli() - now.toEpochMilli() + 30_000) / 60_000).toInt().coerceAtLeast(1)
