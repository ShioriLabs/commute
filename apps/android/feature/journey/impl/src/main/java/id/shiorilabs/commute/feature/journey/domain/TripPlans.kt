package id.shiorilabs.commute.feature.journey.domain

import id.shiorilabs.commute.core.navigation.Route
import id.shiorilabs.commute.core.trip.TripLeg
import id.shiorilabs.commute.core.trip.TripPlan
import id.shiorilabs.commute.core.trip.TripStop
import java.time.Duration
import java.time.Instant

/**
 * The journey as trip mode follows it, copied whole so it runs with no network: each stop with its
 * coordinates and its scheduled time where the API gave them. Trip mode fills in missing
 * coordinates from the station directory when it starts.
 */
fun Journey.toTripPlan(): TripPlan = TripPlan(
    legs.map { leg ->
        when (leg) {
            is JourneyLeg.Ride -> TripLeg.Ride(
                line = leg.line,
                operator = leg.operator,
                headsign = leg.headsign,
                platformCode = leg.platformCode,
                stops = leg.stops.mapIndexed { i, stop -> stop.toTripStop(scheduledAt = leg.stopTimes.getOrNull(i)) },
                departureAt = leg.departureAt,
                arrivalAt = leg.arrivalAt,
                tripId = leg.tripId,
            )
            is JourneyLeg.Transfer -> TripLeg.Transfer(
                from = leg.from.toTripStop(),
                to = leg.to.toTripStop(),
                distanceM = leg.distanceM,
                corridorLabel = leg.corridorLabel,
            )
        }
    },
)

private fun JourneyStop.toTripStop(scheduledAt: Instant? = null) =
    TripStop(id = id, name = name, latitude = latitude, longitude = longitude, scheduledAt = scheduledAt)

/** How long before boarding a trip can be started: time to get to the station. */
val TRIP_START_LEAD: Duration = Duration.ofMinutes(30)

/** Where "Mulai perjalanan" stands for a journey. */
sealed interface TripStart {

    data object Ready : TripStart

    /** Boards later than [TRIP_START_LEAD] from now: a trip that early would only wait. */
    data class TooEarly(val boardsAt: Instant) : TripStart

    /** A trip of this very journey is running: the button opens it instead. */
    data object Running : TripStart
}

/**
 * Whether [journey], opened as [route], can start now. Untimed journeys can start whenever; a
 * running trip counts as this journey when it was started from the same pair, route and boarding.
 */
fun tripStartFor(journey: Journey, route: Route.Trip, running: Route.Trip?, now: Instant): TripStart {
    if (running != null && running.fromId == route.fromId && running.toId == route.toId &&
        running.journeyKey == route.journeyKey && running.boardingClock == route.boardingClock
    ) {
        return TripStart.Running
    }
    val boardsAt = boardsAtOf(journey) ?: return TripStart.Ready
    return if (Duration.between(now, boardsAt) > TRIP_START_LEAD) TripStart.TooEarly(boardsAt) else TripStart.Ready
}
