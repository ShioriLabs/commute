package id.shiorilabs.commute.feature.journey.replan

import id.shiorilabs.commute.core.datastore.FarePreferencesRepository
import id.shiorilabs.commute.core.trip.TripPlan
import id.shiorilabs.commute.feature.journey.data.JourneyRepository
import id.shiorilabs.commute.feature.journey.domain.Journey
import id.shiorilabs.commute.feature.journey.domain.JourneyLeg
import id.shiorilabs.commute.feature.journey.domain.toTripPlan
import id.shiorilabs.commute.feature.journey.presentation.savedroute.homeRouteCriteria
import id.shiorilabs.commute.feature.trip.TripReplanner
import kotlinx.coroutines.flow.first
import java.time.Clock
import java.time.Instant
import javax.inject.Inject

/**
 * Asks for the journeys on from where a trip stands, under the rider's stored settings and leaving
 * now, as a pinned pair's card does, and takes the one that gets there first.
 */
class JourneyTripReplanner @Inject constructor(
    private val journeys: JourneyRepository,
    private val farePreferences: FarePreferencesRepository,
    private val clock: Clock,
) : TripReplanner {

    override suspend fun replan(fromId: String, toId: String, readyAt: Instant, line: String): TripPlan? {
        val criteria = farePreferences.criteria.first().homeRouteCriteria(clock.instant())
        val answer = journeys.trips(fromId, toId, criteria).getOrNull() ?: return null
        return onwardJourney(answer.journeys, fromId, readyAt, line)?.toTripPlan()
    }
}

/**
 * Of [journeys], the one a rider at [fromId] from [readyAt] can still take that arrives first: its
 * first leg a ride from there, leaving no earlier. On [line] when that arrives as soon.
 */
internal fun onwardJourney(journeys: List<Journey>, fromId: String, readyAt: Instant, line: String): Journey? =
    journeys
        .filter { journey ->
            val first = journey.legs.firstOrNull() as? JourneyLeg.Ride ?: return@filter false
            val departs = first.departureAt ?: return@filter false
            first.stops.firstOrNull()?.id == fromId && !departs.isBefore(readyAt)
        }
        .minWithOrNull(
            compareBy<Journey> { it.arrivalAt ?: Instant.MAX }
                .thenBy { (it.legs.first() as JourneyLeg.Ride).line != line },
        )
