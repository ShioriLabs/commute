package id.shiorilabs.commute.feature.map.presentation

import id.shiorilabs.commute.feature.journey.domain.Journey
import id.shiorilabs.commute.feature.journey.domain.JourneyLeg
import id.shiorilabs.commute.feature.map.domain.RouteLeg

/** [this] journey as the map draws it: its rides' stops and its walks, nothing of times or fares. */
fun Journey.routeLegs(): List<RouteLeg> = legs.map { leg ->
    when (leg) {
        is JourneyLeg.Ride -> RouteLeg.Ride(leg.line, leg.operator, leg.stops.map { it.id })
        is JourneyLeg.Transfer -> RouteLeg.Walk(leg.from.id, leg.to.id)
    }
}
