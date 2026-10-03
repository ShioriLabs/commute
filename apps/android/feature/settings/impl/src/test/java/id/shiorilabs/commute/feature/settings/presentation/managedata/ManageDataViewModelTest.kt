package id.shiorilabs.commute.feature.settings.presentation.managedata

import id.shiorilabs.commute.core.datastore.FakePreferencesDataStore
import id.shiorilabs.commute.core.datastore.RecentSearch
import id.shiorilabs.commute.core.datastore.RecentSearchRepository
import id.shiorilabs.commute.core.datastore.SavedRepository
import id.shiorilabs.commute.core.type.UIState
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
class ManageDataViewModelTest {

    private val recents = RecentSearchRepository(FakePreferencesDataStore())
    private val saved = SavedRepository(FakePreferencesDataStore())

    @Before
    fun setUp() {
        Dispatchers.setMain(UnconfinedTestDispatcher())
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    private suspend fun ManageDataViewModel.counts(): StoredData =
        (state.first { it is UIState.Success } as UIState.Success).data

    @Test
    fun `counts what is stored`() = runTest {
        recents.record(RecentSearch(RecentSearch.Type.STATION, "KCI-MRI"))
        recents.record(RecentSearch(RecentSearch.Type.HUB, "dukuh-atas"))
        saved.toggleStation("KCI-MRI")

        assertEquals(StoredData(recentSearches = 2, savedStations = 1), ManageDataViewModel(recents, saved).counts())
    }

    @Test
    fun `clearing one kind leaves the other`() = runTest {
        recents.record(RecentSearch(RecentSearch.Type.STATION, "KCI-MRI"))
        saved.toggleStation("KCI-MRI")
        val viewModel = ManageDataViewModel(recents, saved)

        viewModel.clearRecentSearches()
        assertEquals(StoredData(recentSearches = 0, savedStations = 1), viewModel.counts())

        viewModel.clearSavedStations()
        assertEquals(StoredData(recentSearches = 0, savedStations = 0), viewModel.counts())
    }
}
