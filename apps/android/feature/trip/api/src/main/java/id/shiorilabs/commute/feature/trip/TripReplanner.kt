package id.shiorilabs.commute.feature.trip

import id.shiorilabs.commute.core.trip.TripPlan
import java.time.Instant

/**
 * Finds the way on when the ride a trip is waiting for leaves without the rider: bound by the
 * journey feature, which knows how to ask for journeys, so trip mode needn't.
 */
fun interface TripReplanner {

    /**
     * The legs on from [fromId] to [toId] (`OPERATOR-CODE`) for a rider there from [readyAt], first
     * leg a ride from [fromId]; [line] (`OPERATOR:CODE`) when it gets there as soon. `null` when
     * there's no answer, as offline.
     */
    suspend fun replan(fromId: String, toId: String, readyAt: Instant, line: String): TripPlan?
}
