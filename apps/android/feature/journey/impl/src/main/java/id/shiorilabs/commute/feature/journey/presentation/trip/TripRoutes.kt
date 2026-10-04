package id.shiorilabs.commute.feature.journey.presentation.trip

import id.shiorilabs.commute.core.navigation.Route
import id.shiorilabs.commute.feature.journey.domain.Journey
import id.shiorilabs.commute.feature.journey.domain.JourneyCriteria
import id.shiorilabs.commute.feature.journey.domain.boardingClock
import id.shiorilabs.commute.feature.journey.domain.boardsAtOf
import id.shiorilabs.commute.feature.journey.domain.journeyKey
import id.shiorilabs.commute.feature.journey.domain.toLinkParams

/**
 * The trip page for [journey], one of the answers to [fromId]→[toId] under [criteria]. The criteria
 * are spelled out in full, so the page asks exactly what the opener showed and finds the answer in
 * the cache. The boarding goes too: rows of one route share a key, and the clock tells them apart.
 */
internal fun tripRoute(fromId: String, toId: String, journey: Journey, criteria: JourneyCriteria): Route.Trip {
    val params = criteria.toLinkParams()
    return Route.Trip(
        fromId = fromId,
        toId = toId,
        journeyKey = journeyKey(journey),
        boardingClock = boardsAtOf(journey)?.let(::boardingClock),
        paymentMethod = params.paymentMethod,
        at = params.at,
        modes = params.modes,
        walking = params.walking,
    )
}
