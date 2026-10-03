package id.shiorilabs.commute.feature.settings.presentation.managedata

import id.shiorilabs.commute.core.datastore.FakePreferencesDataStore
import id.shiorilabs.commute.core.datastore.FarePreferencesRepository
import id.shiorilabs.commute.core.datastore.RecentSearch
import id.shiorilabs.commute.core.datastore.RecentSearchRepository
import id.shiorilabs.commute.core.datastore.SavedRepository
import id.shiorilabs.commute.core.query.store.StoredEntry
import id.shiorilabs.commute.core.query.testing.FakeQueryStore
import id.shiorilabs.commute.core.query.testing.testQueryClient
import id.shiorilabs.commute.core.type.UIState
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class ManageDataViewModelTest {

    private val recents = RecentSearchRepository(FakePreferencesDataStore())
    private val saved = SavedRepository(FakePreferencesDataStore())
    private val fares = FarePreferencesRepository(FakePreferencesDataStore())

    private val offline = FakeQueryStore()

    private fun TestScope.viewModel() =
        ManageDataViewModel(recents, saved, fares, testQueryClient(backgroundScope, store = offline))

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
        fares.recordRoute("KCI-SUD", "KCI-BOO")
        saved.toggleStation("KCI-MRI")
        saved.toggleRoute("KCI-SUD", "KCI-BOO")

        assertEquals(StoredData(recentSearches = 3, savedStations = 2), viewModel().counts())
    }

    @Test
    fun `clearing one kind leaves the other`() = runTest {
        recents.record(RecentSearch(RecentSearch.Type.STATION, "KCI-MRI"))
        fares.recordRoute("KCI-SUD", "KCI-BOO")
        saved.toggleStation("KCI-MRI")
        val viewModel = viewModel()

        viewModel.clearRecentSearches()
        assertEquals(StoredData(recentSearches = 0, savedStations = 1), viewModel.counts())

        viewModel.clearSavedStations()
        assertEquals(StoredData(recentSearches = 0, savedStations = 0), viewModel.counts())
    }

    @Test
    fun `the offline copies are sized, and cleared on their own`() = runTest {
        offline.entries["station/KCI-MRI"] = StoredEntry("station/KCI-MRI", "x".repeat(2048), null, 0)
        saved.toggleStation("KCI-MRI")
        val viewModel = viewModel()
        assertEquals(StoredData(recentSearches = 0, savedStations = 1, offlineBytes = 2048), viewModel.counts())

        viewModel.clearOfflineData()

        assertEquals(StoredData(recentSearches = 0, savedStations = 1, offlineBytes = 0), viewModel.counts())
        assertTrue(offline.entries.isEmpty())
    }
}
