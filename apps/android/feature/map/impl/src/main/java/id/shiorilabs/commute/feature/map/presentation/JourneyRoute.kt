package id.shiorilabs.commute.feature.map.presentation

import id.shiorilabs.commute.core.trip.PositionSource
import id.shiorilabs.commute.core.trip.TripLeg
import id.shiorilabs.commute.core.trip.TripPhase
import id.shiorilabs.commute.core.trip.TripPlan
import id.shiorilabs.commute.feature.journey.domain.Journey
import id.shiorilabs.commute.feature.journey.domain.JourneyLeg
import id.shiorilabs.commute.feature.map.domain.RideProgress
import id.shiorilabs.commute.feature.map.domain.RouteLeg
import id.shiorilabs.commute.feature.trip.ActiveTrip

/** [this] journey as the map draws it: its rides' stops and its walks, nothing of times or fares. */
fun Journey.routeLegs(): List<RouteLeg> = legs.map { leg ->
    when (leg) {
        is JourneyLeg.Ride -> RouteLeg.Ride(leg.line, leg.operator, leg.stops.map { it.id })
        is JourneyLeg.Transfer -> RouteLeg.Walk(leg.from.id, leg.to.id)
    }
}

/** [this] trip as the map draws it, leg for leg, so a ride's index is its index in the plan. */
fun TripPlan.routeLegs(): List<RouteLeg> = legs.map { leg ->
    when (leg) {
        is TripLeg.Ride -> RouteLeg.Ride(leg.line, leg.operator, leg.stops.map { it.id })
        is TripLeg.Transfer -> RouteLeg.Walk(leg.from.id, leg.to.id)
    }
}

/** Where [this] trip stands, as the map places the rider: walking from the ride before while on foot. */
fun ActiveTrip.rideProgress(): RideProgress = RideProgress(
    legIndex = state.legIndex,
    riding = state.phase == TripPhase.RIDING,
    arrived = state.phase == TripPhase.ARRIVED,
    position = state.position,
    confirmed = state.source == PositionSource.CONFIRMED,
    walkingFromLeg = state.walkingSince?.let { plan.rideIndices.lastOrNull { it < state.legIndex } },
)
