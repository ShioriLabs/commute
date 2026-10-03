package id.shiorilabs.commute.feature.journey.data.impl

import arrow.core.Either
import arrow.core.right
import id.shiorilabs.commute.core.ext.apiCallToFailure
import id.shiorilabs.commute.core.network.service.CommuteService
import id.shiorilabs.commute.core.type.Failure
import id.shiorilabs.commute.core.type.requireBody
import id.shiorilabs.commute.feature.journey.data.JourneyRepository
import id.shiorilabs.commute.feature.journey.domain.Departure
import id.shiorilabs.commute.feature.journey.domain.JourneyCriteria
import id.shiorilabs.commute.feature.journey.domain.TripAnswer
import id.shiorilabs.commute.feature.journey.domain.quantiseToSlot
import id.shiorilabs.commute.feature.journey.domain.tripQueryParams
import java.time.Clock
import java.time.Instant
import java.util.concurrent.ConcurrentHashMap
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Holds answers in memory, keyed the way the API keys its own cache: the pair, the criteria, and the
 * departure's 20-minute slot. A departure of "now" is keyed by the slot the clock is in, so an
 * answer is reused while its times are still the ones the API would give, and asked again once the
 * clock moves into the next slot. The web's SWR dedupe does the same job for an hour; times go
 * stale long before that. A failure is not cached, so the next call tries again.
 */
@Singleton
class JourneyRepositoryImpl @Inject constructor(
    private val service: CommuteService,
    private val clock: Clock,
) : JourneyRepository {

    private data class Key(val fromId: String, val toId: String, val criteria: JourneyCriteria, val slot: Instant)

    private val answers = ConcurrentHashMap<Key, TripAnswer>()

    override suspend fun trips(fromId: String, toId: String, criteria: JourneyCriteria): Either<Failure, TripAnswer> {
        val slot = when (val departure = criteria.departure) {
            Departure.Now -> quantiseToSlot(clock.instant())
            is Departure.At -> departure.instant
        }
        val key = Key(fromId, toId, criteria, slot)
        return answers[key]?.right() ?: apiCallToFailure {
            val params = tripQueryParams(criteria)
            service.getTrips(
                fromId = fromId,
                toId = toId,
                paymentMethod = params.paymentMethod,
                at = params.at,
                modes = params.modes,
                walking = params.walking,
            ).requireBody().toTripAnswer()
        }.onRight { answer ->
            // Answers for slots the clock has left are never asked for again.
            if (answers.size >= MAX_ANSWERS) {
                answers.clear()
            }
            answers[key] = answer
        }
    }

    private companion object {

        const val MAX_ANSWERS = 32
    }
}
