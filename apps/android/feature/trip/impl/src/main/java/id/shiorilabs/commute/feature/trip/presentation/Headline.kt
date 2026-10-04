package id.shiorilabs.commute.feature.trip.presentation

import id.shiorilabs.commute.core.trip.NextAction
import id.shiorilabs.commute.core.trip.TripLeg
import id.shiorilabs.commute.core.trip.expectedAlightingAt
import id.shiorilabs.commute.core.trip.expectedDepartureAt
import id.shiorilabs.commute.core.trip.progress
import id.shiorilabs.commute.feature.trip.ActiveTrip
import java.time.Instant

/**
 * What the trip says right now, before it is put into words: the line the Live Update, the alerts
 * and the live screen all lead with. Lines are keys (`KCI:C`), resolved to names by whoever renders.
 */
internal sealed interface Headline {

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

internal fun ActiveTrip.headline(): Headline = when (val next = state.progress(plan).next) {
    is NextAction.Board -> Headline.Board(plan.ride(next.legIndex), state.expectedDepartureAt(plan))
    is NextAction.Change -> Headline.Change(plan.ride(next.legIndex), next.transfer, state.expectedDepartureAt(plan))
    is NextAction.RideTo -> Headline.RideTo(plan.ride(next.legIndex), next.stopsLeft, state.expectedAlightingAt(plan))
    is NextAction.AlightNow -> Headline.AlightNow(plan.ride(next.legIndex), next.thenLegIndex?.let(plan::ride))
    NextAction.Arrived -> Headline.Arrived(plan.destination.name)
}

/** Whole minutes from [now] to [at], at least one: "sekitar 2 menit lagi". */
internal fun minutesUntil(now: Instant, at: Instant): Int =
    ((at.toEpochMilli() - now.toEpochMilli() + 30_000) / 60_000).toInt().coerceAtLeast(1)
