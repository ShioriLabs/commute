package id.shiorilabs.commute.feature.settings.presentation.savedstations

import arrow.core.Either
import arrow.core.left
import arrow.core.right
import id.shiorilabs.commute.core.datastore.FakePreferencesDataStore
import id.shiorilabs.commute.core.datastore.SavedEntry
import id.shiorilabs.commute.core.datastore.SavedRepository
import id.shiorilabs.commute.core.time.ServiceDayName
import id.shiorilabs.commute.core.type.Failure
import id.shiorilabs.commute.core.type.UIState
import id.shiorilabs.commute.feature.station.data.StationRepository
import id.shiorilabs.commute.feature.station.domain.Frequency
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
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class SavedStationsSettingsViewModelTest {

    private class FakeStationRepository : StationRepository {
        var station: (String) -> Either<Failure, Station> = { id -> Station(id, id, "KCI", id, emptyList()).right() }

        override suspend fun station(stationId: String) = station.invoke(stationId)

        override suspend fun timetable(stationId: String, day: ServiceDayName): Either<Failure, List<LineTimetable>> =
            emptyList<LineTimetable>().right()

        override suspend fun transfers(stationId: String): Either<Failure, List<Transfer>> = emptyList<Transfer>().right()

        override suspend fun frequencies(stationId: String, day: ServiceDayName): Either<Failure, List<Frequency>> =
            emptyList<Frequency>().right()
    }

    private val saved = SavedRepository(FakePreferencesDataStore())
    private val stations = FakeStationRepository()

    @Before
    fun setUp() {
        Dispatchers.setMain(UnconfinedTestDispatcher())
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    private suspend fun SavedStationsSettingsViewModel.rows(): List<SavedStationRow> =
        (state.first { it is UIState.Success && it.data.none { row -> row.station is UIState.Loading } } as UIState.Success).data

    @Test
    fun `rows follow the saved order, with the ends marked`() = runTest {
        saved.replace(listOf("KCI-MRI", "MRTJ-BHI", "KCI-THB").map(SavedEntry::Station))

        val rows = SavedStationsSettingsViewModel(saved, stations).rows()

        assertEquals(listOf("KCI-MRI", "MRTJ-BHI", "KCI-THB"), rows.map { it.id })
        assertEquals(listOf(true, false, false), rows.map { it.isFirst })
        assertEquals(listOf(false, false, true), rows.map { it.isLast })
    }

    @Test
    fun `a move is stored straight away`() = runTest {
        saved.replace(listOf("KCI-MRI", "MRTJ-BHI").map(SavedEntry::Station))
        val viewModel = SavedStationsSettingsViewModel(saved, stations)
        viewModel.rows()

        viewModel.onMove("MRTJ-BHI", -1)

        assertEquals(listOf("MRTJ-BHI", "KCI-MRI"), saved.stationIds.first())
        assertEquals(listOf("MRTJ-BHI", "KCI-MRI"), viewModel.rows().map { it.id })
    }

    @Test
    fun `an unpinned station keeps its row and comes back to its place`() = runTest {
        saved.replace(listOf("KCI-MRI", "MRTJ-BHI", "KCI-THB").map(SavedEntry::Station))
        val viewModel = SavedStationsSettingsViewModel(saved, stations)
        viewModel.rows()

        viewModel.onToggle("MRTJ-BHI")

        assertEquals(listOf("KCI-MRI", "KCI-THB"), saved.stationIds.first())
        assertEquals(listOf(true, false, true), viewModel.rows().map { it.isSaved })

        viewModel.onToggle("MRTJ-BHI")

        assertEquals(listOf("KCI-MRI", "MRTJ-BHI", "KCI-THB"), saved.stationIds.first())
    }

    @Test
    fun `a station that fails to load has no row, but stays saved`() = runTest {
        saved.replace(listOf("KCI-MRI", "KCI-GONE").map(SavedEntry::Station))
        stations.station = { id ->
            if (id == "KCI-GONE") Failure.Remote(404).left() else Station(id, id, "KCI", id, emptyList()).right()
        }

        val rows = SavedStationsSettingsViewModel(saved, stations).rows()

        assertEquals(listOf("KCI-MRI"), rows.map { it.id })
        assertEquals(listOf("KCI-MRI", "KCI-GONE"), saved.stationIds.first())
    }
}
