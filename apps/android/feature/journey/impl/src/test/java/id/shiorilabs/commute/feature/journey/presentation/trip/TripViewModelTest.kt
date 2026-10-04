package id.shiorilabs.commute.feature.journey.presentation.trip

import arrow.core.Either
import arrow.core.left
import arrow.core.right
import id.shiorilabs.commute.core.datastore.FakePreferencesDataStore
import id.shiorilabs.commute.core.datastore.FarePreferencesRepository
import id.shiorilabs.commute.core.datastore.SavedEntry
import id.shiorilabs.commute.core.datastore.SavedRepository
import id.shiorilabs.commute.core.datastore.StoredFareCriteria
import id.shiorilabs.commute.core.navigation.Route
import id.shiorilabs.commute.core.query.Query
import id.shiorilabs.commute.core.type.Failure
import id.shiorilabs.commute.feature.journey.data.JourneyRepository
import id.shiorilabs.commute.feature.journey.domain.Departure
import id.shiorilabs.commute.feature.journey.domain.Journey
import id.shiorilabs.commute.feature.journey.domain.JourneyCriteria
import id.shiorilabs.commute.feature.journey.domain.JourneyStop
import id.shiorilabs.commute.feature.journey.domain.Modes
import id.shiorilabs.commute.feature.journey.domain.PaymentMethod
import id.shiorilabs.commute.feature.journey.domain.TripAnswer
import id.shiorilabs.commute.feature.journey.domain.journey
import id.shiorilabs.commute.feature.journey.domain.ride
import id.shiorilabs.commute.feature.journey.domain.walk
import id.shiorilabs.commute.feature.station.data.LineRepository
import id.shiorilabs.commute.feature.station.domain.LineInfo
import id.shiorilabs.commute.feature.journey.domain.TripStart
import id.shiorilabs.commute.feature.trip.ActiveTrip
import id.shiorilabs.commute.feature.trip.TripController
import id.shiorilabs.commute.core.trip.RiderAction
import id.shiorilabs.commute.core.trip.TripPlan
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test
import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset

@OptIn(ExperimentalCoroutinesApi::class)
class TripViewModelTest {

    private class FakeJourneyRepository : JourneyRepository {
        val asked = mutableListOf<JourneyCriteria>()
        var answer: () -> Either<Failure, TripAnswer> = { answerOf(early, late, viaDukuhAtas).right() }

        override suspend fun trips(fromId: String, toId: String, criteria: JourneyCriteria): Either<Failure, TripAnswer> {
            asked += criteria
            return answer()
        }

        /** Stands in for the cache's stale-first stream when set; otherwise [trips] answers once. */
        var observed: Flow<Query<TripAnswer>>? = null

        override fun observeTrips(fromId: String, toId: String, criteria: JourneyCriteria): Flow<Query<TripAnswer>> =
            observed ?: super.observeTrips(fromId, toId, criteria)
    }

    private class FakeLineRepository : LineRepository {
        override suspend fun lines(): Either<Failure, Map<String, LineInfo>> = emptyMap<String, LineInfo>().right()
    }

    private class FakeTripController : TripController {
        override val active = MutableStateFlow<ActiveTrip?>(null)
        val started = mutableListOf<Pair<TripPlan, Route.Trip>>()

        override fun start(plan: TripPlan, origin: Route.Trip) {
            started += plan to origin
        }

        override fun riderSaid(action: RiderAction) = Unit

        override fun stop() = Unit
    }

    private companion object {
        /** Two boardings of one route, at 09.00 and 09.15 WIB: they share the key `C.SUD-MRI`. */
        val early = journey(ride("KCI:C", "KCI-SUD", "KCI-MRI", departureAt = Instant.parse("2026-10-05T02:00:00Z")))
        val late = journey(ride("KCI:C", "KCI-SUD", "KCI-MRI", departureAt = Instant.parse("2026-10-05T02:15:00Z")))
        val viaDukuhAtas = journey(walk("KCI-SUD", "MRTJ-DKA"), ride("MRTJ:M", "MRTJ-DKA", "KCI-MRI"))

        fun answerOf(vararg journeys: Journey) = TripAnswer(JourneyStop("KCI-SUD", "From"), JourneyStop("KCI-MRI", "To"), journeys.toList())

        val trip = Route.Trip(fromId = "KCI-SUD", toId = "KCI-MRI", journeyKey = "C.SUD-MRI")
    }

    private val now = Instant.parse("2026-10-05T01:47:00Z")
    private val clock = Clock.fixed(now, ZoneOffset.ofHours(7))
    private val journeys = FakeJourneyRepository()
    private val preferences = FarePreferencesRepository(FakePreferencesDataStore())
    private val saved = SavedRepository(FakePreferencesDataStore())
    private val trips = FakeTripController()

    @Before
    fun setUp() {
        Dispatchers.setMain(UnconfinedTestDispatcher())
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    private fun TestScope.viewModel(route: Route.Trip = trip): TripViewModel {
        val viewModel = TripViewModel(route, journeys, FakeLineRepository(), preferences, saved, clock, trips)
        // WhileSubscribed: the state only flows while someone collects it, as the screen does.
        backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) { viewModel.state.collect {} }
        return viewModel
    }

    private fun TripViewModel.journey(): Journey = (state.value.trip as TripPageState.Loaded).journey

    @Test
    fun `the route's first boarding opens without a clock`() = runTest {
        assertEquals(early, viewModel().journey())
    }

    @Test
    fun `the clock picks the boarding tapped among rows of one route`() = runTest {
        assertEquals(late, viewModel(trip.copy(boardingClock = "0915")).journey())
    }

    @Test
    fun `a boarding no longer in the answer falls to the route's first`() = runTest {
        assertEquals(early, viewModel(trip.copy(boardingClock = "0830")).journey())
    }

    @Test
    fun `a route no longer in the answer is gone, and its options offered on the same ask`() = runTest {
        preferences.saveCriteria(StoredFareCriteria(paymentMethod = "QRIS_TAP"))
        val viewModel = viewModel(trip.copy(journeyKey = "B.SUD-MRI", modes = "rail"))

        assertEquals(TripPageState.Gone, viewModel.state.value.trip)
        assertEquals(
            Route.Otw(fromId = "KCI-SUD", toId = "KCI-MRI", paymentMethod = "QRIS_TAP", at = "now", modes = "rail", walking = "AVERAGE"),
            viewModel.optionsRoute(),
        )
    }

    @Test
    fun `an old answer without the route waits for the fresh one before calling it gone`() = runTest {
        val answers = MutableStateFlow(Query(answerOf(viaDukuhAtas), updatedAt = now, isFetching = true))
        journeys.observed = answers
        val viewModel = viewModel()
        assertEquals(TripPageState.Loading, viewModel.state.value.trip)

        answers.value = Query(answerOf(viaDukuhAtas, late), updatedAt = now)

        assertEquals(late, viewModel.journey())
    }

    @Test
    fun `an answer that couldn't be refreshed is shown outdated`() = runTest {
        journeys.observed = MutableStateFlow(Query(answerOf(early), updatedAt = now, failure = Failure.Network.NoConnection()))

        val loaded = viewModel().state.value.trip as TripPageState.Loaded

        assertEquals(true, loaded.isOutdated)
        assertEquals(now, loaded.updatedAt)
    }

    @Test
    fun `a 404 is no route, anything else a failure that can be retried`() = runTest {
        journeys.answer = { Failure.Remote(404).left() }
        val viewModel = viewModel()
        assertEquals(TripPageState.NotFound, viewModel.state.value.trip)

        journeys.answer = { Failure.Network.NoConnection().left() }
        viewModel.retry()
        assertEquals(TripPageState.Failed, viewModel.state.value.trip)

        journeys.answer = { answerOf(early).right() }
        viewModel.retry()
        assertEquals(early, viewModel.journey())
    }

    @Test
    fun `the opener's criteria, spelled out, beat the stored ones`() = runTest {
        preferences.saveCriteria(StoredFareCriteria(paymentMethod = "QRIS_TAP", fareTime = "2026-10-05T03:00:00Z", modes = "rail"))

        viewModel(tripRoute("KCI-SUD", "KCI-MRI", early, JourneyCriteria()))

        assertEquals(listOf(JourneyCriteria()), journeys.asked)
    }

    @Test
    fun `a shared link's criteria are laid over the stored ones`() = runTest {
        preferences.saveCriteria(StoredFareCriteria(paymentMethod = "QRIS_TAP"))

        viewModel(trip.copy(modes = "rail"))

        assertEquals(JourneyCriteria(PaymentMethod.QRIS_TAP, Departure.Now, Modes.RAIL), journeys.asked.single())
    }

    @Test
    fun `the opener's boarding travels with its route`() {
        val route = tripRoute("KCI-SUD", "KCI-MRI", late, JourneyCriteria())

        assertEquals("C.SUD-MRI", route.journeyKey)
        assertEquals("0915", route.boardingClock)
    }

    @Test
    fun `the share link names the journey`() = runTest {
        assertEquals(
            "https://commute.shiorilabs.id/fare?from=KCI-SUD&to=KCI-MRI&j=C.SUD-MRI",
            viewModel().state.value.shareUrl,
        )
    }

    @Test
    fun `the pin pins the pair`() = runTest {
        val viewModel = viewModel()
        backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) { viewModel.routeSaved.collect {} }
        assertEquals(false, viewModel.routeSaved.value)

        viewModel.onToggleSaveRoute()

        assertEquals(true, viewModel.routeSaved.value)
        assertEquals(listOf(SavedEntry.Route("KCI-SUD", "KCI-MRI")), saved.entries.first())
    }

    @Test
    fun `a pair of one station has no pin`() = runTest {
        val viewModel = viewModel(trip.copy(toId = "KCI-SUD"))
        backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) { viewModel.routeSaved.collect {} }

        assertNull(viewModel.routeSaved.value)
    }

    @Test
    fun `starting the trip follows the loaded journey from this page`() = runTest {
        val viewModel = viewModel()
        backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) { viewModel.tripStart.collect {} }
        // Boards at 09.00, thirteen minutes away.
        assertEquals(TripStart.Ready, viewModel.tripStart.value)

        viewModel.startTrip()

        val (plan, origin) = trips.started.single()
        assertEquals(trip, origin)
        assertEquals(listOf("KCI-SUD", "KCI-MRI"), plan.destination.let { listOf(plan.ride(0).stops.first().id, it.id) })
    }
}
