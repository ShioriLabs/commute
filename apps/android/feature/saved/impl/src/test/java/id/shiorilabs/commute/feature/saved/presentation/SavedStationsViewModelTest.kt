package id.shiorilabs.commute.feature.saved.presentation

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
import id.shiorilabs.commute.feature.station.domain.LineInfo
import id.shiorilabs.commute.feature.station.domain.LineTimetable
import id.shiorilabs.commute.feature.station.domain.Station
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
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
    }

    private class FakeLineRepository : LineRepository {
        override suspend fun lines(): Either<Failure, Map<String, LineInfo>> =
            mapOf("KCI:B" to LineInfo("Lin Bogor", "B", "#EE3D43", "KCI")).right()
    }

    private fun clockAt(iso: String): Clock =
        Clock.fixed(LocalDateTime.parse(iso).atZone(JAKARTA).toInstant(), JAKARTA)

    private val saved = SavedStationsRepository(FakePreferencesDataStore())
    private val stations = FakeStationRepository()

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
        SavedStationsViewModel(saved, stations, FakeLineRepository(), clock)

    private suspend fun SavedStationsViewModel.loaded(): SavedStationsUiState =
        (state.first { it is UIState.Success && it.data.cards.all { card -> card.timetable is UIState.Success } } as UIState.Success).data

    @Test
    fun `nothing saved is an empty feed`() = runTest {
        val feed = (viewModel().state.first { it is UIState.Success } as UIState.Success).data

        assertTrue(feed.cards.isEmpty())
    }

    @Test
    fun `each saved station gets a card, in the rider's order, with the line dictionary`() = runTest {
        saved.save("KCI-MRI")
        saved.save("MRTJ-BHI")

        val feed = viewModel().loaded()

        assertEquals(listOf("KCI-MRI", "MRTJ-BHI"), feed.cards.map { it.stationId })
        assertEquals("Lin Bogor", feed.lines.getValue("KCI:B").name)
    }

    @Test
    fun `boards are fetched for the service day, not the calendar day`() = runTest {
        saved.save("KCI-MRI")

        // 00:30 on a Saturday is still Friday night's service, and Saturday's board comes next.
        val feed = viewModel(clockAt("2026-10-03T00:30:00")).loaded()

        assertEquals(listOf("KCI-MRI" to ServiceDayName.WD, "KCI-MRI" to ServiceDayName.SAT), stations.asked)
        assertTrue(feed.cards.single().nextDayDiffers)
    }

    @Test
    fun `on an ordinary weekday the next board is today's`() = runTest {
        saved.save("KCI-MRI")

        val card = viewModel().loaded().cards.single()

        assertEquals(listOf("KCI-MRI" to ServiceDayName.WD), stations.asked)
        val line = (card.timetable as UIState.Success).data.single()
        assertEquals(line, card.nextDayLine(line))
    }

    @Test
    fun `a station that fails is an error on its own card, and retry loads it again`() = runTest {
        stations.station = { Failure.Network.NoConnection().left() }
        saved.save("KCI-MRI")
        val vm = viewModel()

        val failed = vm.loaded().cards.single()
        assertTrue(failed.station is UIState.Error)

        stations.station = { id -> Station(id, "Manggarai", "KCI", "MRI", emptyList()).right() }
        vm.retry("KCI-MRI")

        val card = vm.loaded().cards.single()
        assertEquals("Manggarai", (card.station as UIState.Success).data.name)
        assertNull(card.nextDayBoard)
    }

    @Test
    fun `the boards refetch when the service day turns over, and only then`() = runTest {
        saved.save("KCI-MRI")
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
