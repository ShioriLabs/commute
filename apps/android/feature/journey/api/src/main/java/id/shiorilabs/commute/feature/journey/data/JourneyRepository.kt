package id.shiorilabs.commute.feature.journey.data

import arrow.core.Either
import id.shiorilabs.commute.core.query.Query
import id.shiorilabs.commute.core.query.queryOnce
import id.shiorilabs.commute.core.type.Failure
import id.shiorilabs.commute.feature.journey.domain.JourneyCriteria
import id.shiorilabs.commute.feature.journey.domain.TripAnswer
import kotlinx.coroutines.flow.Flow

interface JourneyRepository {

    /**
     * The journeys from [fromId] to [toId] (`OPERATOR-CODE`) under [criteria]. A 404 means no route
     * between them, or that they are the same station. When the network fails, the last answer held
     * for the same ask is returned instead, however old.
     */
    suspend fun trips(fromId: String, toId: String, criteria: JourneyCriteria): Either<Failure, TripAnswer>

    /**
     * [trips], stale-while-revalidate: the last answer held for the same ask first, however old,
     * then a fresh one if it was due. Doesn't complete. The default serves an implementation with no
     * cache of its own (a test's fake) from [trips].
     */
    fun observeTrips(fromId: String, toId: String, criteria: JourneyCriteria): Flow<Query<TripAnswer>> =
        queryOnce(null) { trips(fromId, toId, criteria) }

    /**
     * Asks again for every answer between [fromId] and [toId] being observed, whatever their age,
     * and returns once they are in (at once offline). A pull to refresh.
     */
    suspend fun refresh(fromId: String, toId: String) = Unit
}
