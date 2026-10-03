package id.shiorilabs.commute.feature.saved.presentation

import arrow.core.Either
import arrow.core.left
import arrow.core.right
import id.shiorilabs.commute.core.datastore.FakePreferencesDataStore
import id.shiorilabs.commute.core.datastore.SavedRepository
import id.shiorilabs.commute.core.query.Refetched
import id.shiorilabs.commute.core.time.JAKARTA
import id.shiorilabs.commute.core.time.ServiceDayName
import id.shiorilabs.commute.core.type.Failure
import id.shiorilabs.commute.core.type.UIState
import id.shiorilabs.commute.feature.journey.data.JourneyRepository
import id.shiorilabs.commute.feature.journey.domain.JourneyCriteria
import id.shiorilabs.commute.feature.journey.domain.TripAnswer
import id.shiorilabs.commute.feature.station.data.LineRepository
import id.shiorilabs.commute.feature.station.data.StationRepository
import id.shiorilabs.commute.feature.station.domain.Frequency
import id.shiorilabs.commute.feature.station.domain.LineInfo
import id.shiorilabs.commute.feature.station.domain.LineTimetable
import id.shiorilabs.commute.feature.station.domain.Station
import id.shiorilabs.commute.feature.station.domain.Transfer
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.first
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
import java.time.LocalDateTime

@OptIn(ExperimentalCoroutinesApi::class)
class SavedStationsViewModelTest {

    private class FakeStationRepository : StationRepository {
        var station: (String) -> Either<Failure, Station> = { id -> Station(id, id, "KCI", id, emptyList()).right() }
        val asked = mutableListOf<Pair<String, ServiceDayName>>()

        override suspend fun station(stationId: String) = station.invoke(stationId)

        override suspend fun timetable(stationId: String, day: ServiceDayName): Either<Failure, List<LineTimetable>> {
            asked += stationId to day
            return listOf(LineTimetable("KCI:B", emptyList())).right()
        }

        override suspend fun transfers(stationId: String): Either<Failure, List<Transfer>> = emptyList<Transfer>().right()

        override suspend fun frequencies(stationId: String, day: ServiceDayName): Either<Failure, List<Frequency>> =
            emptyList<Frequency>().right()

        val refreshed = mutableListOf<String>()

        /** Holds every refresh until completed, as the network would. */
        var refreshAnswered = CompletableDeferred(Unit)

        /** What each station's refresh finds. */
        var found = Refetched(unchanged = 3)

        override suspend fun refresh(stationId: String): Refetched {
            refreshed += stationId
            refreshAnswered.await()
            return found
        }
    }

    private class FakeJourneyRepository : JourneyRepository {
        val refreshed = mutableListOf<Pair<String, String>>()

        override suspend fun trips(fromId: String, toId: String, criteria: JourneyCriteria): Either<Failure, TripAnswer> =
            error("Home asks for no trips itself: a pair's card does")

        /** What each pair's refresh finds. */
        var found = Refetched(unchanged = 1)

        override suspend fun refresh(fromId: String, toId: String): Refetched {
            refreshed += fromId to toId
            return found
        }
    }

    private class FakeLineRepository : LineRepository {
        override suspend fun lines(): Either<Failure, Map<String, LineInfo>> =
            mapOf("KCI:B" to LineInfo("Lin Bogor", "B", "#EE3D43", "KCI")).right()
    }

    private fun clockAt(iso: String): Clock =
        Clock.fixed(LocalDateTime.parse(iso).atZone(JAKARTA).toInstant(), JAKARTA)

    private val saved = SavedRepository(FakePreferencesDataStore())
    private val stations = FakeStationRepository()
    private val journeys = FakeJourneyRepository()

    @Before
    fun setUp() {
        Dispatchers.setMain(UnconfinedTestDispatcher())
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    // A Wednesday morning: today and tomorrow both run the weekday board.
    private fun viewModel(clock: Clock = clockAt("2026-09-30T08:00:00")) =
        SavedStationsViewModel(saved, stations, FakeLineRepository(), journeys, clock)

    private suspend fun SavedStationsViewModel.loaded(): SavedStationsUiState =
        (state.first { it is UIState.Success && it.data.stationBoards.all { card -> card.timetable is UIState.Success } } as UIState.Success).data

    @Test
    fun `nothing saved is an empty feed`() = runTest {
        val feed = (viewModel().state.first { it is UIState.Success } as UIState.Success).data

        assertTrue(feed.stationBoards.isEmpty())
    }

    @Test
    fun `each saved station gets a card, in the rider's order, with the line dictionary`() = runTest {
        saved.toggleStation("KCI-MRI")
        saved.toggleStation("MRTJ-BHI")

        val feed = viewModel().loaded()

        assertEquals(listOf("KCI-MRI", "MRTJ-BHI"), feed.stationBoards.map { it.stationId })
        assertEquals("Lin Bogor", feed.lines.getValue("KCI:B").name)
    }

    @Test
    fun `a pinned pair sits in the feed in the rider's order, titled by its stations`() = runTest {
        stations.station = { id -> Station(id, if (id == "KCI-SUD") "Sudirman" else "Bogor", "KCI", id, emptyList()).right() }
        saved.toggleStation("KCI-MRI")
        saved.toggleRoute("KCI-SUD", "KCI-BOO")

        val feed = viewModel().state.first { state ->
            state is UIState.Success && state.data.entries.any { it is HomeEntry.RouteEntry && it.toName != null }
        } as UIState.Success

        assertEquals(listOf("station:KCI-MRI", "route:KCI-SUD>KCI-BOO"), feed.data.entries.map { it.key })
        val pair = feed.data.entries[1] as HomeEntry.RouteEntry
        assertEquals("Sudirman" to "Bogor", pair.fromName to pair.toName)
        // A pair's card asks for its own trips: no board is fetched for its stations.
        assertEquals(listOf("KCI-MRI"), stations.asked.map { it.first }.distinct())
    }

    @Test
    fun `a pull to refresh asks every pinned station and pair again, and spins until they answer`() = runTest {
        saved.toggleStation("KCI-MRI")
        saved.toggleRoute("KCI-SUD", "KCI-BOO")
        val viewModel = viewModel()
        viewModel.loaded()
        stations.refreshAnswered = CompletableDeferred()

        viewModel.refresh()

        assertTrue(viewModel.loaded().isRefreshing)
        assertEquals(listOf("KCI-MRI"), stations.refreshed)
        assertEquals(listOf("KCI-SUD" to "KCI-BOO"), journeys.refreshed)

        // A second pull while the first runs is the same refresh.
        viewModel.refresh()
        assertEquals(listOf("KCI-MRI"), stations.refreshed)

        stations.refreshAnswered.complete(Unit)

        assertFalse(viewModel.loaded().isRefreshing)
    }

    @Test
    fun `a refresh says what it found, once, and a new pull clears it`() = runTest {
        saved.toggleStation("KCI-MRI")
        saved.toggleRoute("KCI-SUD", "KCI-BOO")
        journeys.found = Refetched(changed = 1)
        val viewModel = viewModel()
        viewModel.loaded()

        viewModel.refresh()
        assertEquals(RefreshNotice.Updated(1), viewModel.loaded().refreshNotice)

        viewModel.onRefreshNoticeShown()
        assertNull(viewModel.loaded().refreshNotice)

        stations.refreshAnswered = CompletableDeferred()
        journeys.found = Refetched(unchanged = 1)
        viewModel.refresh()
        assertNull(viewModel.loaded().refreshNotice)
        stations.refreshAnswered.complete(Unit)
        assertEquals(RefreshNotice.UpToDate, viewModel.loaded().refreshNotice)
    }

    @Test
    fun `boards are fetched for the service day, not the calendar day`() = runTest {
        saved.toggleStation("KCI-MRI")

        // 00:30 on a Saturday is still Friday night's service, and Saturday's board comes next.
        val feed = viewModel(clockAt("2026-10-03T00:30:00")).loaded()

        assertEquals(listOf("KCI-MRI" to ServiceDayName.WD, "KCI-MRI" to ServiceDayName.SAT), stations.asked)
        assertTrue(feed.stationBoards.single().nextDayDiffers)
    }

    @Test
    fun `on an ordinary weekday the next board is today's`() = runTest {
        saved.toggleStation("KCI-MRI")

        val card = viewModel().loaded().stationBoards.single()

        assertEquals(listOf("KCI-MRI" to ServiceDayName.WD), stations.asked)
        val line = (card.timetable as UIState.Success).data.single()
        assertEquals(line, card.nextDayLine(line))
    }

    @Test
    fun `a station that fails is an error on its own card, and retry loads it again`() = runTest {
        stations.station = { Failure.Network.NoConnection().left() }
        saved.toggleStation("KCI-MRI")
        val vm = viewModel()

        val failed = vm.loaded().stationBoards.single()
        assertTrue(failed.station is UIState.Error)

        stations.station = { id -> Station(id, "Manggarai", "KCI", "MRI", emptyList()).right() }
        vm.retry("KCI-MRI")

        val card = vm.loaded().stationBoards.single()
        assertEquals("Manggarai", (card.station as UIState.Success).data.name)
        assertNull(card.nextDayBoard)
    }

    @Test
    fun `the boards refetch when the service day turns over, and only then`() = runTest {
        saved.toggleStation("KCI-MRI")
        val vm = viewModel(clockAt("2026-10-02T22:00:00"))
        vm.loaded()
        stations.asked.clear()

        // Wednesday into Thursday would be the same weekday board; Friday night into the small
        // hours is still Friday's service.
        vm.onClockTick(LocalDateTime.parse("2026-10-03T01:00:00"))
        assertTrue(stations.asked.isEmpty())

        // Saturday's service starts at 03:00.
        vm.onClockTick(LocalDateTime.parse("2026-10-03T03:00:00"))
        assertEquals(ServiceDayName.SAT, stations.asked.first().second)
    }
}
