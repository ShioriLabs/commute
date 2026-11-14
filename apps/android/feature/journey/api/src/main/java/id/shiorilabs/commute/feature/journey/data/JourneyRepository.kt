package id.shiorilabs.commute.feature.journey.data

import id.shiorilabs.commute.core.query.Refetched
import id.shiorilabs.commute.core.query.Resource
import id.shiorilabs.commute.feature.journey.domain.JourneyCriteria
import id.shiorilabs.commute.feature.journey.domain.TripAnswer

interface JourneyRepository {

    /**
     * The journeys from [fromId] to [toId] (`OPERATOR-CODE`) under [criteria]. A 404 means no route
     * between them, or that they are the same station. When the network fails, the last answer held
     * for the same ask is returned instead, however old.
     */
    fun trips(fromId: String, toId: String, criteria: JourneyCriteria): Resource<TripAnswer>

    /**
     * Asks again for every answer between [fromId] and [toId] being observed, whatever their age,
     * and once they are in (at once offline) says what they found. A pull to refresh.
     */
    suspend fun refresh(fromId: String, toId: String): Refetched = Refetched()
}
