package id.shiorilabs.commute.feature.journey.presentation

import arrow.core.Either
import arrow.core.left
import arrow.core.right
import id.shiorilabs.commute.core.datastore.FakePreferencesDataStore
import id.shiorilabs.commute.core.datastore.FarePreferencesRepository
import id.shiorilabs.commute.core.datastore.RecentRoute
import id.shiorilabs.commute.core.datastore.SavedEntry
import id.shiorilabs.commute.core.datastore.SavedRepository
import id.shiorilabs.commute.core.datastore.StoredFareCriteria
import id.shiorilabs.commute.core.navigation.Route
import id.shiorilabs.commute.core.type.Failure
import id.shiorilabs.commute.feature.journey.data.JourneyRepository
import id.shiorilabs.commute.feature.journey.domain.Departure
import id.shiorilabs.commute.feature.journey.domain.JourneyCriteria
import id.shiorilabs.commute.feature.journey.domain.JourneyStop
import id.shiorilabs.commute.feature.journey.domain.Modes
import id.shiorilabs.commute.feature.journey.domain.PairEnd
import id.shiorilabs.commute.feature.journey.domain.PaymentMethod
import id.shiorilabs.commute.feature.journey.domain.StationPair
import id.shiorilabs.commute.feature.journey.domain.TripAnswer
import id.shiorilabs.commute.feature.journey.domain.journey
import id.shiorilabs.commute.feature.journey.domain.ride
import id.shiorilabs.commute.feature.journey.domain.walk
import id.shiorilabs.commute.feature.search.data.SearchRepository
import id.shiorilabs.commute.feature.search.domain.Searchable
import id.shiorilabs.commute.feature.station.data.LineRepository
import id.shiorilabs.commute.feature.station.domain.LineInfo
import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
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

@OptIn(ExperimentalCoroutinesApi::class)
class JourneyViewModelTest {

    private class FakeJourneyRepository : JourneyRepository {
        val asked = mutableListOf<Triple<String, String, JourneyCriteria>>()
        var answer: (String, String) -> Either<Failure, TripAnswer> = { from, to ->
            TripAnswer(JourneyStop(from, "From"), JourneyStop(to, "To"), listOf(direct, viaDukuhAtas)).right()
        }

        override suspend fun trips(fromId: String, toId: String, criteria: JourneyCriteria): Either<Failure, TripAnswer> {
            asked += Triple(fromId, toId, criteria)
            return answer(fromId, toId)
        }
    }

    private class FakeSearchRepository : SearchRepository {
        override suspend fun searchables(): Either<Failure, List<Searchable>> = listOf(
            station("KCI-SUD", "Sudirman"),
            station("KCI-MRI", "Manggarai"),
            station("MRTJ-LBB", "Lebak Bulus Grab"),
        ).right()

        private fun station(id: String, title: String) = Searchable.Station(
            title = title,
            to = "/stations/${id.replace('-', '/')}",
            keywords = listOf(title.lowercase()),
            subtitle = null,
            score = null,
            stationId = id,
            operator = id.substringBefore('-'),
            lines = emptyList(),
        )
    }

    private class FakeLineRepository : LineRepository {
        override suspend fun lines(): Either<Failure, Map<String, LineInfo>> = emptyMap<String, LineInfo>().right()
    }

    private companion object {
        val direct = journey(ride("KCI:C", "KCI-SUD", "KCI-MRI"))
        val viaDukuhAtas = journey(walk("KCI-SUD", "MRTJ-DKA"), ride("MRTJ:M", "MRTJ-DKA", "MRTJ-LBB"))
    }

    private val now = Instant.parse("2026-10-05T01:47:00Z")
    private val clock = Clock.fixed(now, ZoneOffset.ofHours(7))
    private val journeys = FakeJourneyRepository()
    private val preferences = FarePreferencesRepository(FakePreferencesDataStore())
    private val saved = SavedRepository(FakePreferencesDataStore())

    @Before
    fun setUp() {
        Dispatchers.setMain(UnconfinedTestDispatcher())
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    private fun TestScope.viewModel(route: Route.Journey = Route.Journey()): JourneyViewModel {
        val viewModel = JourneyViewModel(route, journeys, FakeSearchRepository(), FakeLineRepository(), preferences, saved, clock)
        // WhileSubscribed: the state only flows while someone collects it, as the screen does.
        backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) { viewModel.state.collect {} }
        return viewModel
    }

    @Test
    fun `a station's OTW opens the origin picker and waits for it`() = runTest {
        val viewModel = viewModel(Route.Journey(toId = "MRTJ-LBB"))

        val state = viewModel.state.value
        assertEquals(PairEnd.ORIGIN, state.picker)
        assertEquals("Lebak Bulus Grab", state.destination?.name)
        assertEquals(TripState.Idle, state.trip)
        assertEquals(emptyList<Any>(), journeys.asked)
    }

    @Test
    fun `picking the origin asks for the trip and lands on its options`() = runTest {
        val viewModel = viewModel(Route.Journey(toId = "MRTJ-LBB"))
        val sudirman = viewModel.picker.first { it.loaded }.stations.first { it.id == "KCI-SUD" }

        viewModel.onPick(sudirman)

        val state = viewModel.state.value
        assertNull(state.picker)
        assertEquals(StationPair("KCI-SUD", "MRTJ-LBB"), state.pair)
        assertEquals(2, (state.trip as TripState.Loaded).answer.journeys.size)
        assertEquals(JourneyPage.OPTIONS, state.page)
        assertEquals(listOf("KCI-SUD"), preferences.recentStationIds.first())
    }

    @Test
    fun `picking the other end's station swaps the pair`() = runTest {
        val viewModel = viewModel(Route.Journey(fromId = "KCI-SUD", toId = "MRTJ-LBB"))
        val lebakBulus = viewModel.picker.first { it.loaded }.stations.first { it.id == "MRTJ-LBB" }

        viewModel.openPicker(PairEnd.ORIGIN)
        viewModel.onPick(lebakBulus)

        assertEquals(StationPair("MRTJ-LBB", "KCI-SUD"), viewModel.state.value.pair)
    }

    @Test
    fun `the first ask uses the rider's stored settings, not the defaults`() = runTest {
        preferences.saveCriteria(StoredFareCriteria(paymentMethod = "QRIS_TAP"))

        viewModel(Route.Journey(fromId = "KCI-SUD", toId = "MRTJ-LBB"))

        assertEquals(listOf(PaymentMethod.QRIS_TAP), journeys.asked.map { it.third.paymentMethod })
    }

    @Test
    fun `a link's settings beat the stored ones for the visit`() = runTest {
        preferences.saveCriteria(StoredFareCriteria(paymentMethod = "QRIS_TAP", modes = "all"))

        viewModel(Route.Journey(fromId = "KCI-SUD", toId = "MRTJ-LBB", modes = "rail"))

        val asked = journeys.asked.single().third
        assertEquals(PaymentMethod.QRIS_TAP, asked.paymentMethod)
        assertEquals(Modes.RAIL, asked.modes)
    }

    @Test
    fun `a 404 is no route, anything else a failure that can be retried`() = runTest {
        journeys.answer = { _, _ -> Failure.Remote(404).left() }
        val viewModel = viewModel(Route.Journey(fromId = "KCI-SUD", toId = "MRTJ-LBB"))
        assertEquals(TripState.NotFound, viewModel.state.value.trip)

        journeys.answer = { _, _ -> Failure.Network.NoConnection().left() }
        viewModel.retry()
        assertEquals(TripState.Failed, viewModel.state.value.trip)

        journeys.answer = { from, to -> TripAnswer(JourneyStop(from, "From"), JourneyStop(to, "To"), listOf(direct)).right() }
        viewModel.retry()
        assertEquals(1, (viewModel.state.value.trip as TripState.Loaded).answer.journeys.size)
    }

    @Test
    fun `the pin pins the pair on screen, one way only`() = runTest {
        val viewModel = viewModel(Route.Journey(fromId = "KCI-SUD", toId = "MRTJ-LBB"))
        backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) { viewModel.routeSaved.collect {} }
        assertEquals(false, viewModel.routeSaved.value)

        viewModel.onToggleSaveRoute()
        assertEquals(true, viewModel.routeSaved.value)
        assertEquals(listOf(SavedEntry.Route("KCI-SUD", "MRTJ-LBB")), saved.entries.first())

        // The return trip is another pair.
        viewModel.onSwap()
        assertEquals(false, viewModel.routeSaved.value)
    }

    @Test
    fun `there is no pin without both ends`() = runTest {
        val viewModel = viewModel(Route.Journey(toId = "MRTJ-LBB"))
        backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) { viewModel.routeSaved.collect {} }

        assertNull(viewModel.routeSaved.value)
        viewModel.onToggleSaveRoute()
        assertEquals(emptyList<SavedEntry>(), saved.entries.first())
    }

    @Test
    fun `a pair that answered becomes a recent one, named, with its pin`() = runTest {
        val viewModel = viewModel(Route.Journey(fromId = "KCI-SUD", toId = "MRTJ-LBB"))
        backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) { viewModel.recentRoutes.collect {} }
        saved.toggleRoute("KCI-SUD", "MRTJ-LBB")

        val recent = viewModel.recentRoutes.first { it.isNotEmpty() }.single()
        assertEquals(RecentRouteRow("KCI-SUD", "MRTJ-LBB", "Sudirman", "Lebak Bulus Grab", saved = true), recent)

        viewModel.onClearRecentRoutes()
        assertEquals(emptyList<RecentRouteRow>(), viewModel.recentRoutes.first { it.isEmpty() })
    }

    @Test
    fun `a pair that failed is not offered back`() = runTest {
        journeys.answer = { _, _ -> Failure.Remote(404).left() }

        viewModel(Route.Journey(fromId = "KCI-SUD", toId = "MRTJ-LBB"))

        assertEquals(emptyList<RecentRoute>(), preferences.recentRoutes.first())
    }

    @Test
    fun `a shared journey opens on its detail, once`() = runTest {
        val viewModel = viewModel(
            Route.Journey(fromId = "KCI-SUD", toId = "MRTJ-LBB", journeyKey = "_DKA~M.DKA-LBB"),
        )
        assertEquals(JourneyPage.DETAIL, viewModel.state.value.page)
        assertEquals(1, viewModel.state.value.selected)

        // A new answer is a new list: back to the options.
        viewModel.onCriteriaChange(JourneyCriteria(paymentMethod = PaymentMethod.QRIS_TAP))
        assertEquals(JourneyPage.OPTIONS, viewModel.state.value.page)
        assertEquals(0, viewModel.state.value.selected)
    }

    @Test
    fun `a changed setting is asked for and kept`() = runTest {
        val viewModel = viewModel(Route.Journey(fromId = "KCI-SUD", toId = "MRTJ-LBB"))

        viewModel.onCriteriaChange(JourneyCriteria(paymentMethod = PaymentMethod.QRIS_TAP))

        assertEquals(PaymentMethod.QRIS_TAP, journeys.asked.last().third.paymentMethod)
        assertEquals("QRIS_TAP", preferences.criteria.first()?.paymentMethod)
    }

    @Test
    fun `a departure the clock overtook goes back to now on resume`() = runTest {
        val viewModel = viewModel(Route.Journey(fromId = "KCI-SUD", toId = "MRTJ-LBB"))
        // Picked for 08.00; the clock reads 08.47 by the time the screen comes back.
        viewModel.onCriteriaChange(JourneyCriteria(departure = Departure.At(Instant.parse("2026-10-05T01:00:00Z"))))

        viewModel.onResume()

        assertEquals(Departure.Now, viewModel.state.value.criteria.departure)
    }

    @Test
    fun `the share link carries the selected journey`() = runTest {
        val viewModel = viewModel(Route.Journey(fromId = "KCI-SUD", toId = "MRTJ-LBB"))

        viewModel.onSelectJourney(1)

        assertEquals(
            "https://commute.shiorilabs.id/fare?from=KCI-SUD&to=MRTJ-LBB&j=_DKA%7EM.DKA-LBB",
            viewModel.state.value.shareUrl,
        )
    }
}
