package id.shiorilabs.commute.feature.saved.presentation.nearby

import arrow.core.Either
import arrow.core.right
import id.shiorilabs.commute.core.datastore.FakePreferencesDataStore
import id.shiorilabs.commute.core.datastore.HomePreferencesRepository
import id.shiorilabs.commute.core.datastore.LocationPreferencesRepository
import id.shiorilabs.commute.core.datastore.SavedRepository
import id.shiorilabs.commute.core.geo.GeoPoint
import id.shiorilabs.commute.core.location.Fix
import id.shiorilabs.commute.core.location.testing.FakeLocationClient
import id.shiorilabs.commute.core.time.ServiceDayName
import id.shiorilabs.commute.core.type.Failure
import id.shiorilabs.commute.feature.station.data.StationDirectory
import id.shiorilabs.commute.feature.station.data.StationRepository
import id.shiorilabs.commute.feature.station.domain.Frequency
import id.shiorilabs.commute.feature.station.domain.LineTimetable
import id.shiorilabs.commute.feature.station.domain.Station
import id.shiorilabs.commute.feature.station.domain.Transfer
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
import org.junit.Before
import org.junit.Test
import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset

@OptIn(ExperimentalCoroutinesApi::class)
class NearbyViewModelTest {

    private val sudirman = Station("KCI-SUD", "Sudirman", "KCI", "SUD", listOf("KCI:B"), latitude = -6.2024, longitude = 106.8237)
    private val dukuhAtas = Station("MRTJ-DKA", "Dukuh Atas BNI", "MRTJ", "DKA", listOf("MRTJ:M"), latitude = -6.2007, longitude = 106.8227)
    private val manggarai = Station("KCI-MRI", "Manggarai", "KCI", "MRI", listOf("KCI:C"), latitude = -6.2099, longitude = 106.8502)

    private val now = Instant.parse("2026-10-04T01:00:00Z")
    private val location = FakeLocationClient(currentFix = Fix(GeoPoint(-6.2020, 106.8233), 20f, now))
    private val saved = SavedRepository(FakePreferencesDataStore())
    private val home = HomePreferencesRepository(FakePreferencesDataStore())
    private val locationPreferences = LocationPreferencesRepository(FakePreferencesDataStore())

    private val directory = object : StationDirectory {
        override suspend fun all(): Either<Failure, List<Station>> = listOf(sudirman, dukuhAtas, manggarai).right()
    }

    private val stations = object : StationRepository {
        override suspend fun station(stationId: String): Either<Failure, Station> =
            listOf(sudirman, dukuhAtas, manggarai).first { it.id == stationId }.right()
        override suspend fun timetable(stationId: String, day: ServiceDayName): Either<Failure, List<LineTimetable>> =
            emptyList<LineTimetable>().right()
        override suspend fun transfers(stationId: String): Either<Failure, List<Transfer>> = emptyList<Transfer>().right()
        override suspend fun frequencies(stationId: String, day: ServiceDayName): Either<Failure, List<Frequency>> =
            emptyList<Frequency>().right()
    }

    @Before
    fun setUp() {
        Dispatchers.setMain(UnconfinedTestDispatcher())
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    private val lookup = NearbyLookup(location, directory, saved, locationPreferences, Clock.fixed(now, ZoneOffset.UTC))

    private fun TestScope.viewModel(): NearbyViewModel {
        val viewModel = NearbyViewModel(location, lookup, stations, home, locationPreferences, Clock.fixed(now, ZoneOffset.ofHours(7)))
        backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) { viewModel.state.collect {} }
        backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) { viewModel.raised.collect {} }
        backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) { viewModel.settled.collect {} }
        return viewModel
    }

    @Test
    fun `with location, the nearest unpinned stations show with their boards`() = runTest {
        saved.toggleStation("KCI-SUD")
        val viewModel = viewModel()

        viewModel.refresh()

        val shown = viewModel.state.first { it is NearbyUiState.Stations } as NearbyUiState.Stations
        // Sudirman is pinned, so it is already on home; Manggarai is too far to walk.
        assertEquals(listOf("MRTJ-DKA"), shown.boards.map { it.nearby.station.id })
    }

    @Test
    fun `a pinned station the rider is at is raised to the top of home, not shown in this section`() = runTest {
        saved.toggleStation("KCI-SUD")
        saved.toggleStation("KCI-MRI")
        val viewModel = viewModel()

        viewModel.refresh()

        // Manggarai is pinned too, but a few kilometres off.
        assertEquals(listOf("KCI-SUD"), viewModel.raised.first { it.isNotEmpty() })
        val shown = viewModel.state.first { it is NearbyUiState.Stations } as NearbyUiState.Stations
        assertEquals(listOf("MRTJ-DKA"), shown.boards.map { it.nearby.station.id })
    }

    @Test
    fun `turned off in settings, nothing is raised either`() = runTest {
        saved.toggleStation("KCI-SUD")
        locationPreferences.setHomeNearby(false)
        val viewModel = viewModel()

        viewModel.refresh()

        assertEquals(emptyList<String>(), viewModel.raised.value)
    }

    @Test
    fun `turned off in settings, home shows nothing and takes no fix`() = runTest {
        locationPreferences.setHomeNearby(false)
        val viewModel = viewModel()

        viewModel.refresh()

        assertEquals(NearbyUiState.Hidden, viewModel.state.value)
        assertEquals(0, location.currentCalls)
    }

    @Test
    fun `with every use of location off, home offers nothing either`() = runTest {
        location.granted = false
        locationPreferences.setEnabled(false)
        val viewModel = viewModel()

        viewModel.refresh()

        assertEquals(NearbyUiState.Hidden, viewModel.state.value)
    }

    @Test
    fun `without location, home offers rather than asks`() = runTest {
        location.granted = false
        val viewModel = viewModel()

        viewModel.refresh()

        assertEquals(NearbyUiState.Prompt, viewModel.state.value)
    }

    @Test
    fun `a waved-off offer stays gone`() = runTest {
        location.granted = false
        val viewModel = viewModel()

        viewModel.dismissPrompt()

        assertEquals(NearbyUiState.Hidden, viewModel.state.first { it != NearbyUiState.Prompt })
    }

    @Test
    fun `granting from the offer shows the stations`() = runTest {
        location.granted = false
        val viewModel = viewModel()
        location.granted = true

        viewModel.onPermissionResult(true)

        assertEquals(2, (viewModel.state.first { it is NearbyUiState.Stations } as NearbyUiState.Stations).boards.size)
    }

    @Test
    fun `what the splash's look found is what home opens on, without looking again`() = runTest {
        lookup.look()
        val viewModel = viewModel()

        viewModel.refresh()

        val shown = viewModel.state.first { it is NearbyUiState.Stations } as NearbyUiState.Stations
        assertEquals(listOf("KCI-SUD", "MRTJ-DKA"), shown.boards.map { it.nearby.station.id })
        assertEquals(true, viewModel.settled.value)
        assertEquals(1, location.currentCalls)
    }

    @Test
    fun `home is unsettled until a look has finished`() = runTest {
        val viewModel = viewModel()
        assertEquals(false, viewModel.settled.value)

        viewModel.refresh()

        assertEquals(true, viewModel.settled.first { it })
    }

    @Test
    fun `a look that finds no fix still settles home, with nothing to show`() = runTest {
        location.currentFix = null
        val viewModel = viewModel()

        viewModel.refresh()

        assertEquals(true, viewModel.settled.first { it })
        assertEquals(NearbyUiState.Hidden, viewModel.state.value)
    }

    @Test
    fun `without location, or with it turned off for home, there is nothing to wait for`() = runTest {
        location.granted = false
        assertEquals(true, viewModel().settled.first { it })

        location.granted = true
        locationPreferences.setHomeNearby(false)
        assertEquals(true, viewModel().settled.first { it })
    }
}
