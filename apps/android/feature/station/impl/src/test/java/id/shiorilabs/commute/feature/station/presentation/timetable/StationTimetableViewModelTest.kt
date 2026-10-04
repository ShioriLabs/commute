package id.shiorilabs.commute.feature.station.presentation.timetable

import arrow.core.Either
import arrow.core.right
import id.shiorilabs.commute.core.time.JAKARTA
import id.shiorilabs.commute.core.time.ServiceDayName
import id.shiorilabs.commute.core.type.Failure
import id.shiorilabs.commute.core.type.UIState
import id.shiorilabs.commute.feature.station.data.LineRepository
import id.shiorilabs.commute.feature.station.data.StationRepository
import id.shiorilabs.commute.feature.station.domain.Departure
import id.shiorilabs.commute.feature.station.domain.DestinationTimetable
import id.shiorilabs.commute.feature.station.domain.DirectionGroup
import id.shiorilabs.commute.feature.station.domain.Frequency
import id.shiorilabs.commute.feature.station.domain.LineInfo
import id.shiorilabs.commute.feature.station.domain.LineTimetable
import id.shiorilabs.commute.feature.station.domain.Station
import id.shiorilabs.commute.feature.station.domain.Transfer
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import id.shiorilabs.commute.core.query.Query
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.flowOf
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
import java.time.LocalDateTime

@OptIn(ExperimentalCoroutinesApi::class)
class StationTimetableViewModelTest {

    private fun line(key: String) = LineTimetable(
        key,
        listOf(DirectionGroup("g", listOf("Bogor"), null, listOf(DestinationTimetable("Bogor", null, listOf(Departure(null, 480)))))),
    )

    private class FakeStationRepository(private val board: List<LineTimetable>) : StationRepository {
        val asked = mutableListOf<ServiceDayName>()

        override suspend fun station(stationId: String): Either<Failure, Station> =
            Station(stationId, "Manggarai", "KCI", "MRI", emptyList()).right()

        override suspend fun timetable(stationId: String, day: ServiceDayName): Either<Failure, List<LineTimetable>> {
            asked += day
            return board.right()
        }

        override suspend fun transfers(stationId: String): Either<Failure, List<Transfer>> = emptyList<Transfer>().right()

        override suspend fun frequencies(stationId: String, day: ServiceDayName): Either<Failure, List<Frequency>> =
            emptyList<Frequency>().right()
    }

    private class FakeLineRepository : LineRepository {
        override suspend fun lines(): Either<Failure, Map<String, LineInfo>> = emptyMap<String, LineInfo>().right()
    }

    private fun clockAt(iso: String): Clock =
        Clock.fixed(LocalDateTime.parse(iso).atZone(JAKARTA).toInstant(), JAKARTA)

    @Before
    fun setUp() {
        Dispatchers.setMain(UnconfinedTestDispatcher())
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    @Test
    fun `after midnight it is still the night's service day board`() = runTest {
        val stations = FakeStationRepository(listOf(line("KCI:B")))
        // 00:30 on a Saturday: Friday night's trains still run off the weekday board.
        val vm = StationTimetableViewModel("KCI-MRI", stations, FakeLineRepository(), clockAt("2026-10-03T00:30:00"))

        val state = vm.state.first { it.sections is UIState.Success }

        assertEquals(listOf(ServiceDayName.WD), stations.asked)
        assertEquals("Manggarai", state.title)
    }

    @Test
    fun `a board that couldn't be refreshed is shown with its age, for the offline notice`() = runTest {
        val confirmed = Instant.parse("2026-09-30T00:00:00Z")
        val stations = object : StationRepository by FakeStationRepository(listOf(line("KCI:B"))) {
            override fun observeTimetable(stationId: String, day: ServiceDayName): Flow<Query<List<LineTimetable>>> =
                flowOf(Query(listOf(line("KCI:B")), updatedAt = confirmed, failure = Failure.Network.NoConnection()))
        }

        val state = StationTimetableViewModel("KCI-MRI", stations, FakeLineRepository(), clockAt("2026-09-30T08:00:00"))
            .state.first { it.sections is UIState.Success }

        assertEquals(true, state.isOutdated)
        assertEquals(confirmed, state.updatedAt)
        assertEquals(listOf("KCI:B"), state.lineKeys)
    }

    @Test
    fun `the filter hides a line's sections and brings them back`() = runTest {
        val vm = StationTimetableViewModel(
            "KCI-MRI",
            FakeStationRepository(listOf(line("KCI:B"), line("KCI:C"))),
            FakeLineRepository(),
            clockAt("2026-09-30T08:00:00"),
        )
        assertEquals(listOf("KCI:B", "KCI:C"), vm.state.first { it.sections is UIState.Success }.lineKeys)

        vm.onToggleLine("KCI:B")
        assertEquals(listOf("KCI:C"), vm.state.first { it.excluded.isNotEmpty() }.visibleSections.map { it.lineKey })

        vm.onToggleLine("KCI:B")
        assertEquals(listOf("KCI:B", "KCI:C"), vm.state.first { it.excluded.isEmpty() }.visibleSections.map { it.lineKey })
    }
}
