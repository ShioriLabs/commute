package id.shiorilabs.commute.feature.journey.replan

import id.shiorilabs.commute.core.datastore.FarePreferencesRepository
import id.shiorilabs.commute.core.trip.TripPlan
import id.shiorilabs.commute.feature.journey.data.JourneyRepository
import id.shiorilabs.commute.feature.journey.domain.Departure
import id.shiorilabs.commute.feature.journey.domain.Journey
import id.shiorilabs.commute.feature.journey.domain.JourneyLeg
import id.shiorilabs.commute.feature.journey.domain.resolveTimedLegs
import id.shiorilabs.commute.feature.journey.domain.retimeJourney
import id.shiorilabs.commute.feature.journey.domain.toTripPlan
import id.shiorilabs.commute.feature.journey.presentation.savedroute.homeRouteCriteria
import id.shiorilabs.commute.feature.trip.TripReplanner
import kotlinx.coroutines.flow.first
import java.time.Clock
import java.time.Instant
import java.time.temporal.ChronoUnit
import javax.inject.Inject

/**
 * Asks for the journeys on from where a trip stands, under the rider's stored settings, from when the
 * rider can be there (see [replanDeparture]), and takes the one that gets there first.
 */
class JourneyTripReplanner @Inject constructor(
    private val journeys: JourneyRepository,
    private val farePreferences: FarePreferencesRepository,
    private val clock: Clock,
) : TripReplanner {

    override suspend fun replan(fromId: String, toId: String, readyAt: Instant, line: String): TripPlan? {
        val now = clock.instant()
        val criteria = farePreferences.criteria.first().homeRouteCriteria(now)
            .copy(departure = replanDeparture(readyAt, now))
        val answer = journeys.trips(fromId, toId, criteria).getOrNull() ?: return null
        return onwardJourney(answer.journeys, fromId, readyAt, line)?.toTripPlan()
    }
}

/**
 * When to ask the journeys from: the minute the rider can be there, or now if that's gone by. The API
 * offers only a few trains of each route, counted from the time asked; asked from "now" or the start
 * of the slot, a rider ready 15 minutes on found every one of them already left (09.41 to 09.58, nine
 * empty answers in a row, all from the one cached "now").
 */
internal fun replanDeparture(readyAt: Instant, now: Instant): Departure =
    Departure.At(maxOf(readyAt, now).truncatedTo(ChronoUnit.MINUTES))

/**
 * Of [journeys], the one a rider at [fromId] from [readyAt] can still take that arrives first: its
 * first leg a ride from there, leaving no earlier. On [line] when that arrives as soon.
 *
 * The API times each journey on one train of its first leg, which can have left a few seconds
 * before the rider is ready while the trains after it, in `upcomingDepartures`, are still to come:
 * the journey is then re-timed onto the first of those the rider can make.
 */
internal fun onwardJourney(journeys: List<Journey>, fromId: String, readyAt: Instant, line: String): Journey? =
    journeys
        .mapNotNull { journey -> catchableFrom(journey, fromId, readyAt) }
        .minWithOrNull(
            compareBy<Journey> { it.arrivalAt ?: Instant.MAX }
                .thenBy { (it.legs.first() as JourneyLeg.Ride).line != line },
        )

/** [journey] as the rider at [fromId] can take it from [readyAt]: as timed, or on the next train that works; `null` if none. */
private fun catchableFrom(journey: Journey, fromId: String, readyAt: Instant): Journey? {
    val first = journey.legs.firstOrNull() as? JourneyLeg.Ride ?: return null
    if (first.stops.firstOrNull()?.id != fromId) return null
    val departs = first.departureAt ?: return null
    if (!departs.isBefore(readyAt)) return journey

    // The first of the trains the rider can make that the rest of the journey still connects from: a
    // slow one can miss the change a faster one after it makes.
    return first.upcomingDepartures
        .filter { !it.departureAt.isBefore(readyAt) }
        .firstNotNullOfOrNull { next ->
            val timed = resolveTimedLegs(journey.legs, picks = mapOf(0 to next.tripId), notBefore = readyAt)
            val retimed = retimeJourney(journey, timed)
            val ride = retimed.legs.first() as JourneyLeg.Ride
            retimed.takeIf { ride.tripId == next.tripId }
        }
}
