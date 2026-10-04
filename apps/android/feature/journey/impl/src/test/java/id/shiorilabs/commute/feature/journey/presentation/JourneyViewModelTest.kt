package id.shiorilabs.commute.feature.journey.presentation

import arrow.core.Either
import arrow.core.left
import arrow.core.right
import id.shiorilabs.commute.core.datastore.FakePreferencesDataStore
import id.shiorilabs.commute.core.datastore.FarePreferencesRepository
import id.shiorilabs.commute.core.datastore.LocationPreferencesRepository
import id.shiorilabs.commute.core.datastore.RecentRoute
import id.shiorilabs.commute.core.datastore.SavedEntry
import id.shiorilabs.commute.core.datastore.SavedRepository
import id.shiorilabs.commute.core.datastore.StoredFareCriteria
import id.shiorilabs.commute.core.navigation.Route
import id.shiorilabs.commute.core.query.Query
import id.shiorilabs.commute.core.type.Failure
import id.shiorilabs.commute.feature.journey.data.JourneyRepository
import id.shiorilabs.commute.feature.journey.domain.Departure
import id.shiorilabs.commute.feature.journey.domain.JourneyCriteria
import id.shiorilabs.commute.feature.journey.domain.JourneyStop
import id.shiorilabs.commute.feature.journey.domain.Modes
import id.shiorilabs.commute.feature.journey.domain.PairEnd
import id.shiorilabs.commute.core.geo.GeoPoint
import id.shiorilabs.commute.core.location.Fix
import id.shiorilabs.commute.core.location.testing.FakeLocationClient
import id.shiorilabs.commute.feature.station.data.StationDirectory
import id.shiorilabs.commute.feature.station.domain.Station
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
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset

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

        /** Stands in for the cache's stale-first stream when set; otherwise [trips] answers once. */
        var observed: Flow<Query<TripAnswer>>? = null

        override fun observeTrips(fromId: String, toId: String, criteria: JourneyCriteria): Flow<Query<TripAnswer>> =
            observed ?: super.observeTrips(fromId, toId, criteria)
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
    private val location = FakeLocationClient()
    private val locationPreferences = LocationPreferencesRepository(FakePreferencesDataStore())
    private val directory = object : StationDirectory {
        override suspend fun all(): Either<Failure, List<Station>> = listOf(
            Station("KCI-SUD", "Sudirman", "KCI", "SUD", emptyList(), latitude = -6.2024, longitude = 106.8237),
            Station("KCI-MRI", "Manggarai", "KCI", "MRI", emptyList(), latitude = -6.2099, longitude = 106.8502),
            Station("MRTJ-LBB", "Lebak Bulus Grab", "MRTJ", "LBB", emptyList(), latitude = -6.2895, longitude = 106.7744),
        ).right()
    }

    @Before
    fun setUp() {
        Dispatchers.setMain(UnconfinedTestDispatcher())
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    private fun TestScope.viewModel(seed: Route.Otw = Route.Otw()): JourneyViewModel {
        val viewModel = JourneyViewModel(seed, journeys, FakeSearchRepository(), FakeLineRepository(), preferences, saved, clock, location, directory, locationPreferences)
        // WhileSubscribed: the state only flows while someone collects it, as the screen does.
        backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) { viewModel.state.collect {} }
        return viewModel
    }

    @Test
    fun `a station's OTW opens the origin picker and waits for it`() = runTest {
        val viewModel = viewModel(Route.Otw(toId = "MRTJ-LBB"))

        val state = viewModel.state.value
        assertEquals(PairEnd.ORIGIN, state.picker)
        assertEquals("Lebak Bulus Grab", state.destination?.name)
        assertEquals(TripState.Idle, state.trip)
        assertEquals(emptyList<Any>(), journeys.asked)
    }

    @Test
    fun `picking the origin asks for the trip and lands on its options`() = runTest {
        val viewModel = viewModel(Route.Otw(toId = "MRTJ-LBB"))
        val sudirman = viewModel.picker.first { it.loaded }.stations.first { it.id == "KCI-SUD" }

        viewModel.onPick(sudirman)

        val state = viewModel.state.value
        assertNull(state.picker)
        assertEquals(StationPair("KCI-SUD", "MRTJ-LBB"), state.pair)
        assertEquals(2, (state.trip as TripState.Loaded).answer.journeys.size)
        assertEquals(listOf("KCI-SUD"), preferences.recentStationIds.first())
    }

    @Test
    fun `picking the other end's station swaps the pair`() = runTest {
        val viewModel = viewModel(Route.Otw(fromId = "KCI-SUD", toId = "MRTJ-LBB"))
        val lebakBulus = viewModel.picker.first { it.loaded }.stations.first { it.id == "MRTJ-LBB" }

        viewModel.openPicker(PairEnd.ORIGIN)
        viewModel.onPick(lebakBulus)

        assertEquals(StationPair("MRTJ-LBB", "KCI-SUD"), viewModel.state.value.pair)
    }

    @Test
    fun `the first ask uses the rider's stored settings, not the defaults`() = runTest {
        preferences.saveCriteria(StoredFareCriteria(paymentMethod = "QRIS_TAP"))

        viewModel(Route.Otw(fromId = "KCI-SUD", toId = "MRTJ-LBB"))

        assertEquals(listOf(PaymentMethod.QRIS_TAP), journeys.asked.map { it.third.paymentMethod })
    }

    @Test
    fun `a link's settings beat the stored ones for the visit`() = runTest {
        preferences.saveCriteria(StoredFareCriteria(paymentMethod = "QRIS_TAP", modes = "all"))

        viewModel(Route.Otw(fromId = "KCI-SUD", toId = "MRTJ-LBB", modes = "rail"))

        val asked = journeys.asked.single().third
        assertEquals(PaymentMethod.QRIS_TAP, asked.paymentMethod)
        assertEquals(Modes.RAIL, asked.modes)
    }

    @Test
    fun `the held answer shows while it refreshes, then the fresh one`() = runTest {
        val held = TripAnswer(JourneyStop("KCI-SUD", "From"), JourneyStop("MRTJ-LBB", "To"), listOf(direct, viaDukuhAtas))
        val answers = MutableStateFlow(Query(held, updatedAt = now, isFetching = true))
        journeys.observed = answers
        val viewModel = viewModel(Route.Otw(fromId = "KCI-SUD", toId = "MRTJ-LBB"))
        assertTrue((viewModel.state.value.trip as TripState.Loaded).isRefreshing)

        // The fresh answer orders them the other way round.
        answers.value = Query(held.copy(journeys = listOf(viaDukuhAtas, direct)), updatedAt = now)

        val trip = viewModel.state.value.trip as TripState.Loaded
        assertEquals(listOf(viaDukuhAtas, direct), trip.answer.journeys)
        assertFalse(trip.isRefreshing)
    }

    @Test
    fun `an answer that couldn't be refreshed is shown outdated, and not offered back as a recent`() = runTest {
        val held = TripAnswer(JourneyStop("KCI-SUD", "From"), JourneyStop("MRTJ-LBB", "To"), listOf(direct))
        journeys.observed = flowOf(Query(held, updatedAt = now, failure = Failure.Network.NoConnection()))

        val viewModel = viewModel(Route.Otw(fromId = "KCI-SUD", toId = "MRTJ-LBB"))

        val trip = viewModel.state.value.trip as TripState.Loaded
        assertTrue(trip.isOutdated)
        assertEquals(now, trip.updatedAt)
        assertEquals(emptyList<RecentRoute>(), preferences.recentRoutes.first())
    }

    @Test
    fun `a 404 is no route, anything else a failure that can be retried`() = runTest {
        journeys.answer = { _, _ -> Failure.Remote(404).left() }
        val viewModel = viewModel(Route.Otw(fromId = "KCI-SUD", toId = "MRTJ-LBB"))
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
        val viewModel = viewModel(Route.Otw(fromId = "KCI-SUD", toId = "MRTJ-LBB"))
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
        val viewModel = viewModel(Route.Otw(toId = "MRTJ-LBB"))
        backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) { viewModel.routeSaved.collect {} }

        assertNull(viewModel.routeSaved.value)
        viewModel.onToggleSaveRoute()
        assertEquals(emptyList<SavedEntry>(), saved.entries.first())
    }

    @Test
    fun `a pair that answered becomes a recent one, named, with its pin`() = runTest {
        val viewModel = viewModel(Route.Otw(fromId = "KCI-SUD", toId = "MRTJ-LBB"))
        backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) { viewModel.recentRoutes.collect {} }
        saved.toggleRoute("KCI-SUD", "MRTJ-LBB")

        val recent = viewModel.recentRoutes.first { it.isNotEmpty() }.single()
        assertEquals(RecentRouteRow("KCI-SUD", "MRTJ-LBB", "Sudirman", "Lebak Bulus Grab", saved = true), recent)

        viewModel.onClearRecentRoutes()
        assertEquals(emptyList<RecentRouteRow>(), viewModel.recentRoutes.first { it.isEmpty() })
    }

    @Test
    fun `a recent pair is asked for in place of the one on screen`() = runTest {
        val viewModel = viewModel(Route.Otw(toId = "KCI-MRI"))

        viewModel.onOpenRecent(RecentRouteRow("KCI-SUD", "MRTJ-LBB", "Sudirman", "Lebak Bulus Grab", saved = false))

        val state = viewModel.state.value
        assertNull(state.picker)
        assertEquals(StationPair("KCI-SUD", "MRTJ-LBB"), state.pair)
        assertEquals("KCI-SUD" to "MRTJ-LBB", journeys.asked.last().let { it.first to it.second })
    }

    @Test
    fun `a pair that failed is not offered back`() = runTest {
        journeys.answer = { _, _ -> Failure.Remote(404).left() }

        viewModel(Route.Otw(fromId = "KCI-SUD", toId = "MRTJ-LBB"))

        assertEquals(emptyList<RecentRoute>(), preferences.recentRoutes.first())
    }

    @Test
    fun `a changed setting is asked for and kept`() = runTest {
        val viewModel = viewModel(Route.Otw(fromId = "KCI-SUD", toId = "MRTJ-LBB"))

        viewModel.onCriteriaChange(JourneyCriteria(paymentMethod = PaymentMethod.QRIS_TAP))

        assertEquals(PaymentMethod.QRIS_TAP, journeys.asked.last().third.paymentMethod)
        assertEquals("QRIS_TAP", preferences.criteria.first()?.paymentMethod)
    }

    @Test
    fun `a departure the clock overtook goes back to now on resume`() = runTest {
        val viewModel = viewModel(Route.Otw(fromId = "KCI-SUD", toId = "MRTJ-LBB"))
        // Picked for 08.00; the clock reads 08.47 by the time the screen comes back.
        viewModel.onCriteriaChange(JourneyCriteria(departure = Departure.At(Instant.parse("2026-10-05T01:00:00Z"))))

        viewModel.onResume()

        assertEquals(Departure.Now, viewModel.state.value.criteria.departure)
    }

    @Test
    fun `using the rider's location offers the stations around them, nearest first`() = runTest {
        location.currentFix = Fix(GeoPoint(-6.2030, 106.8240), 20f, now)
        val viewModel = viewModel()
        viewModel.picker.first { it.loaded }
        viewModel.openPicker(PairEnd.ORIGIN)

        viewModel.onUseLocation()

        val nearby = viewModel.picker.first { it.nearby is NearbyPicks.Found }.nearby as NearbyPicks.Found
        // Manggarai is about 3 km off: too far to walk to, so not "near".
        assertEquals(listOf("KCI-SUD"), nearby.stations.map { it.first.id })
    }

    @Test
    fun `turned off in settings, the picker doesn't offer the rider's location or take a fix`() = runTest {
        location.currentFix = Fix(GeoPoint(-6.2030, 106.8240), 20f, now)
        locationPreferences.setPickerNearby(false)
        val viewModel = viewModel()
        viewModel.picker.first { it.loaded }

        viewModel.onUseLocation()

        assertEquals(NearbyPicks.Off, viewModel.picker.first { it.loaded }.nearby)
        assertEquals(0, location.currentCalls)
    }

    @Test
    fun `without a fix the picker says so instead of guessing`() = runTest {
        location.granted = false
        val viewModel = viewModel()
        viewModel.picker.first { it.loaded }

        viewModel.onUseLocation()

        assertEquals(NearbyPicks.Unavailable, viewModel.picker.first { it.nearby != NearbyPicks.Idle && it.nearby != NearbyPicks.Locating }.nearby)
    }
}
