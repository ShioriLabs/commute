package id.shiorilabs.commute.feature.journey.data.impl

import arrow.core.Either
import id.shiorilabs.commute.core.ext.onDataThread
import id.shiorilabs.commute.core.model.models.TripResult
import id.shiorilabs.commute.core.network.service.CommuteService
import id.shiorilabs.commute.core.query.Query
import id.shiorilabs.commute.core.query.QueryClient
import id.shiorilabs.commute.core.query.QueryPolicy
import id.shiorilabs.commute.core.query.QuerySpec
import id.shiorilabs.commute.core.query.Refetched
import id.shiorilabs.commute.core.query.queryKey
import id.shiorilabs.commute.core.type.Failure
import id.shiorilabs.commute.feature.journey.data.JourneyRepository
import id.shiorilabs.commute.feature.journey.domain.DEPARTURE_SLOT_MINUTES
import id.shiorilabs.commute.feature.journey.domain.Departure
import id.shiorilabs.commute.feature.journey.domain.JourneyCriteria
import id.shiorilabs.commute.feature.journey.domain.TripAnswer
import id.shiorilabs.commute.feature.journey.domain.quantiseToSlot
import id.shiorilabs.commute.feature.journey.domain.tripQueryParams
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flowOn
import kotlinx.coroutines.flow.map
import java.time.Duration
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Serves answers through the [QueryClient], keyed by the pair and the criteria as they are sent.
 *
 * A departure of "now" leaves the clock out of the key and goes stale instead when its 20-minute
 * slot ends, the grain the API keys its own cache by: an answer is reused while its times are still
 * the ones the API would give, asked again in the next slot, and the last one for a pair is still
 * there to show (with its age) when the next can't be had. A picked departure is its own key, kept
 * as briefly as a fare.
 */
@Singleton
class JourneyRepositoryImpl @Inject constructor(
    private val service: CommuteService,
    private val queries: QueryClient,
) : JourneyRepository {

    private fun tripsQuery(fromId: String, toId: String, criteria: JourneyCriteria): QuerySpec<TripResult> {
        val params = tripQueryParams(criteria)
        val sent = listOfNotNull(
            params.paymentMethod?.let { "pay=$it" },
            params.at?.let { "at=$it" },
            params.modes?.let { "modes=$it" },
            params.walking?.let { "walk=$it" },
        ).joinToString("&").ifEmpty { "default" }
        return QuerySpec(
            key = queryKey(TRIPS, fromId, toId, sent),
            serializer = TripResult.serializer(),
            policy = when (criteria.departure) {
                Departure.Now -> UntilSlotEnds
                is Departure.At -> QueryPolicy.Fare
            },
        ) { etag ->
            service.getTrips(
                fromId = fromId,
                toId = toId,
                paymentMethod = params.paymentMethod,
                at = params.at,
                modes = params.modes,
                walking = params.walking,
                ifNoneMatch = etag,
            )
        }
    }

    override suspend fun trips(fromId: String, toId: String, criteria: JourneyCriteria): Either<Failure, TripAnswer> =
        queries.fetch(tripsQuery(fromId, toId, criteria)).let { result -> onDataThread { result.map { it.toTripAnswer() } } }

    override fun observeTrips(fromId: String, toId: String, criteria: JourneyCriteria): Flow<Query<TripAnswer>> =
        queries.observe(tripsQuery(fromId, toId, criteria))
            .map { query -> query.map { it.toTripAnswer() } }
            .flowOn(Dispatchers.Default)

    override suspend fun refresh(fromId: String, toId: String): Refetched =
        queries.refetch(queryKey(TRIPS, fromId, toId))

    private companion object {

        const val TRIPS = "trips"

        /** Fresh until the end of the departure slot it was fetched in. */
        val UntilSlotEnds = QueryPolicy { fetchedAt ->
            quantiseToSlot(fetchedAt).plus(Duration.ofMinutes(DEPARTURE_SLOT_MINUTES.toLong()))
        }
    }
}
