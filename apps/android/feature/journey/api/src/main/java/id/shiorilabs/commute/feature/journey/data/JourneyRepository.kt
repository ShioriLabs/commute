package id.shiorilabs.commute.feature.journey.data

import arrow.core.Either
import id.shiorilabs.commute.core.type.Failure
import id.shiorilabs.commute.feature.journey.domain.JourneyCriteria
import id.shiorilabs.commute.feature.journey.domain.TripAnswer

interface JourneyRepository {

    /**
     * The journeys from [fromId] to [toId] (`OPERATOR-CODE`) under [criteria]. A 404 means no route
     * between them, or that they are the same station.
     */
    suspend fun trips(fromId: String, toId: String, criteria: JourneyCriteria): Either<Failure, TripAnswer>
}
