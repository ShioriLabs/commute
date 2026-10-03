package id.shiorilabs.commute.feature.station.presentation

import arrow.core.Either
import arrow.core.left
import arrow.core.right
import id.shiorilabs.commute.core.datastore.FakePreferencesDataStore
import id.shiorilabs.commute.core.datastore.SavedStationsRepository
import id.shiorilabs.commute.core.time.JAKARTA
import id.shiorilabs.commute.core.time.ServiceDayName
import id.shiorilabs.commute.core.type.Failure
import id.shiorilabs.commute.core.type.UIState
import id.shiorilabs.commute.feature.station.data.LineRepository
import id.shiorilabs.commute.feature.station.data.StationRepository
import id.shiorilabs.commute.feature.station.domain.Frequency
import id.shiorilabs.commute.feature.station.domain.LineInfo
import id.shiorilabs.commute.feature.station.domain.LineTimetable
import id.shiorilabs.commute.feature.station.domain.Station
import id.shiorilabs.commute.feature.station.domain.Transfer
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
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.time.Clock
import java.time.LocalDateTime

@OptIn(ExperimentalCoroutinesApi::class)
class StationViewModelTest {

    private class FakeStationRepository : StationRepository {
        var station: (String) -> Either<Failure, Station> = { id -> Station(id, "Manggarai", "KCI", "MRI", listOf("KCI:B")).right() }
        val asked = mutableListOf<Pair<String, ServiceDayName>>()
        var cached = false

        override suspend fun station(stationId: String) = station.invoke(stationId)

        override fun cachedStation(stationId: String) =
            if (cached) Station(stationId, "Manggarai", "KCI", "MRI", listOf("KCI:B")) else null

        override fun cachedTimetable(stationId: String, day: ServiceDayName) =
            if (cached) listOf(LineTimetable("KCI:B", emptyList())) else null

        override suspend fun timetable(stationId: String, day: ServiceDayName): Either<Failure, List<LineTimetable>> {
            asked += stationId to day
            return listOf(LineTimetable("KCI:B", emptyList())).right()
        }

        var transfers: Either<Failure, List<Transfer>> = emptyList<Transfer>().right()

        override suspend fun transfers(stationId: String) = transfers

        val askedFrequencies = mutableListOf<Pair<String, ServiceDayName>>()

        override suspend fun frequencies(stationId: String, day: ServiceDayName): Either<Failure, List<Frequency>> {
            askedFrequencies += stationId to day
            return listOf(Frequency("TJ:13", 186.0)).right()
        }
    }

    private class FakeLineRepository : LineRepository {
        var calls = 0
        var result: Either<Failure, Map<String, LineInfo>> =
            mapOf("KCI:B" to LineInfo("Lin Bogor", "B", "#EE3D43", "KCI")).right()

        override suspend fun lines(): Either<Failure, Map<String, LineInfo>> {
            calls++
            return result
        }
    }

    private fun clockAt(iso: String): Clock =
        Clock.fixed(LocalDateTime.parse(iso).atZone(JAKARTA).toInstant(), JAKARTA)

    private val saved = SavedStationsRepository(FakePreferencesDataStore())
    private val stations = FakeStationRepository()
    private val lines = FakeLineRepository()

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
        StationViewModel("KCI-MRI", stations, lines, saved, clock)

    private suspend fun StationViewModel.loaded(): StationUiState =
        state.first { it.board.station !is UIState.Loading && it.board.timetable !is UIState.Loading }

    @Test
    fun `the page loads the station, its board for the service day, and the line dictionary`() = runTest {
        val page = viewModel().loaded()

        assertEquals("Manggarai", (page.board.station as UIState.Success).data.name)
        assertTrue(page.board.timetable is UIState.Success)
        assertEquals("Lin Bogor", page.lines.getValue("KCI:B").name)
        assertEquals(listOf("KCI-MRI" to ServiceDayName.WD), stations.asked)
    }

    @Test
    fun `a halte's page loads its frequencies for the service day`() = runTest {
        stations.station = { id -> Station(id, "Petukangan D'MASIV", "TJ", "H00001P", listOf("TJ:13")).right() }

        val page = StationViewModel("TJ-H00001P", stations, lines, saved, clockAt("2026-10-03T08:00:00"))
            .state.first { it.board.frequencies is UIState.Success }

        assertEquals(listOf(Frequency("TJ:13", 186.0)), (page.board.frequencies as UIState.Success).data)
        assertEquals(listOf("TJ-H00001P" to ServiceDayName.SAT), stations.askedFrequencies)
    }

    @Test
    fun `an unserved station asks for nothing, even on retry, and carries its notice`() = runTest {
        var stationCalls = 0
        stations.station = { id ->
            stationCalls++
            Station(id, "Gambir", "KCI", "GMR", emptyList()).right()
        }

        val vm = StationViewModel("KCI-GMR", stations, lines, saved, clockAt("2026-09-30T08:00:00"))
        vm.retry()
        val page = vm.state.first()

        assertEquals(unservedStation("KCI-GMR"), page.unserved)
        assertEquals(0, stationCalls)
        assertTrue(stations.asked.isEmpty())
        assertEquals(0, lines.calls)
    }

    @Test
    fun `a retired station still loads its page, under its notice`() = runTest {
        val page = StationViewModel("KCI-KAT", stations, lines, saved, clockAt("2026-09-30T08:00:00")).loaded()

        assertEquals(retiredStation("KCI-KAT"), page.retired)
        assertEquals(null, page.unserved)
        assertEquals(listOf("KCI-KAT" to ServiceDayName.WD), stations.asked)
    }

    @Test
    fun `a rail station's page never asks for frequencies`() = runTest {
        viewModel().loaded()

        assertTrue(stations.askedFrequencies.isEmpty())
    }

    @Test
    fun `the pin reflects the saved list and toggles it`() = runTest {
        val vm = viewModel()
        assertFalse(vm.loaded().saved)

        vm.onToggleSave()
        assertTrue(vm.state.first { it.saved }.saved)
        assertEquals(listOf("KCI-MRI"), saved.stations.first())

        vm.onToggleSave()
        assertFalse(vm.state.first { !it.saved }.saved)
        assertTrue(saved.stations.first().isEmpty())
    }

    @Test
    fun `a station that fails is an error, and retry loads it again with the dictionary`() = runTest {
        stations.station = { Failure.Network.NoConnection().left() }
        lines.result = Failure.Network.NoConnection().left()
        val vm = viewModel()
        assertTrue(vm.loaded().board.station is UIState.Error)

        stations.station = { id -> Station(id, "Manggarai", "KCI", "MRI", emptyList()).right() }
        lines.result = emptyMap<String, LineInfo>().right()
        vm.retry()

        assertEquals("Manggarai", (vm.loaded().board.station as UIState.Success).data.name)
        assertEquals(2, lines.calls)
    }

    @Test
    fun `the board refetches when the service day turns over, and only then`() = runTest {
        val vm = viewModel(clockAt("2026-10-02T22:00:00"))
        vm.loaded()
        stations.asked.clear()

        // Friday night into the small hours is still Friday's service.
        vm.onClockTick(LocalDateTime.parse("2026-10-03T01:00:00"))
        assertTrue(stations.asked.isEmpty())

        // Saturday's service starts at 03:00.
        vm.onClockTick(LocalDateTime.parse("2026-10-03T03:00:00"))
        assertEquals(ServiceDayName.SAT, stations.asked.first().second)
    }

    @Test
    fun `a station the home feed already loaded opens whole, without a loading frame`() = runTest {
        stations.cached = true

        val vm = viewModel()

        assertTrue(vm.state.value.board.station is UIState.Success)
        assertTrue(vm.state.value.board.timetable is UIState.Success)
        assertTrue(stations.asked.isEmpty())
    }

    @Test
    fun `transfers load with the page, and a failed load is retried with it`() = runTest {
        stations.transfers = Failure.Network.NoConnection().left()
        val vm = viewModel()
        assertTrue(vm.state.first { it.transfers !is UIState.Loading && it.transfers !is UIState.Idle }.transfers is UIState.Error)

        val walk = Transfer.External("T-1", 230, null, "Halim", "KCIC")
        stations.transfers = listOf(walk).right()
        vm.retry()

        assertEquals(listOf(walk), (vm.state.first { it.transfers is UIState.Success }.transfers as UIState.Success).data)
    }
}
