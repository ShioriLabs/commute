package id.shiorilabs.commute.feature.journey.presentation.savedroute

import arrow.core.Either
import arrow.core.right
import id.shiorilabs.commute.core.datastore.FakePreferencesDataStore
import id.shiorilabs.commute.core.datastore.FarePreferencesRepository
import id.shiorilabs.commute.core.query.Query
import id.shiorilabs.commute.core.type.Failure
import id.shiorilabs.commute.core.type.UIState
import id.shiorilabs.commute.feature.journey.data.JourneyRepository
import id.shiorilabs.commute.feature.journey.domain.Departure
import id.shiorilabs.commute.feature.journey.domain.JourneyCriteria
import id.shiorilabs.commute.feature.journey.domain.TripAnswer
import id.shiorilabs.commute.feature.journey.domain.journey
import id.shiorilabs.commute.feature.journey.domain.ride
import id.shiorilabs.commute.feature.journey.domain.stop
import id.shiorilabs.commute.feature.station.data.LineRepository
import id.shiorilabs.commute.feature.station.domain.LineInfo
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset

@OptIn(ExperimentalCoroutinesApi::class)
class SavedRouteViewModelTest {

    private val answer = TripAnswer(stop("KCI-SUD", "Sudirman"), stop("KCI-BOO", "Bogor"), listOf(journey(ride("KCI:B", "KCI-SUD", "KCI-BOO"))))

    /** Holds [held] for this session, and a live answer that never lands, as on a warm start's first frames. */
    private class FakeJourneyRepository(private val held: TripAnswer?) : JourneyRepository {
        val peeked = mutableListOf<JourneyCriteria>()

        override suspend fun trips(fromId: String, toId: String, criteria: JourneyCriteria): Either<Failure, TripAnswer> =
            error("The card observes its trips")

        override fun observeTrips(fromId: String, toId: String, criteria: JourneyCriteria): Flow<Query<TripAnswer>> =
            flow { awaitCancellation() }

        override fun cachedTrips(fromId: String, toId: String, criteria: JourneyCriteria): TripAnswer? {
            peeked += criteria
            return held
        }
    }

    private class FakeLineRepository : LineRepository {
        override suspend fun lines(): Either<Failure, Map<String, LineInfo>> = emptyMap<String, LineInfo>().right()
    }

    private val clock = Clock.fixed(Instant.parse("2026-10-05T01:47:00Z"), ZoneOffset.ofHours(7))
    private val preferences = FarePreferencesRepository(FakePreferencesDataStore())

    @Before
    fun setUp() {
        Dispatchers.setMain(UnconfinedTestDispatcher())
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    private fun viewModel(journeys: JourneyRepository) =
        SavedRouteViewModel("KCI-SUD", "KCI-BOO", journeys, preferences, FakeLineRepository(), clock)

    @Test
    fun `an answer this session already holds shows at once, for now, not a skeleton`() = runTest {
        // Home has read the settings before, as any earlier screen will have.
        preferences.criteria.first()
        val journeys = FakeJourneyRepository(held = answer)

        val state = viewModel(journeys).state.value

        assertEquals(UIState.Success(answer), state.answer)
        assertEquals(Departure.Now, journeys.peeked.single().departure)
    }

    @Test
    fun `with nothing held, or the settings not yet read, it loads`() = runTest {
        assertTrue(viewModel(FakeJourneyRepository(held = answer)).state.value.answer is UIState.Loading)

        preferences.criteria.first()

        assertTrue(viewModel(FakeJourneyRepository(held = null)).state.value.answer is UIState.Loading)
    }
}
