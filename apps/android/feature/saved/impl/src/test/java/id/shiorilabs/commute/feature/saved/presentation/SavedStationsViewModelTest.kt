package id.shiorilabs.commute.feature.saved.presentation

import id.shiorilabs.commute.core.datastore.FakePreferencesDataStore
import id.shiorilabs.commute.core.datastore.SavedStationsRepository
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
class SavedStationsViewModelTest {

    @Before
    fun setUp() {
        Dispatchers.setMain(UnconfinedTestDispatcher())
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    @Test
    fun `stations starts as Loading before anyone collects`() {
        val viewModel = SavedStationsViewModel(SavedStationsRepository(FakePreferencesDataStore()))

        assertEquals(UIState.Loading, viewModel.stations.value)
    }

    @Test
    fun `stations is an empty Success when nothing was saved`() = runTest {
        val viewModel = SavedStationsViewModel(SavedStationsRepository(FakePreferencesDataStore()))

        val settled = viewModel.stations.first { it !is UIState.Loading }

        assertEquals(UIState.Success(emptyList<String>()), settled)
    }

    @Test
    fun `stations carries the saved ids in order`() = runTest {
        val repository = SavedStationsRepository(FakePreferencesDataStore())
        repository.save("KCI-MRI")
        repository.save("MRTJ-BHI")
        val viewModel = SavedStationsViewModel(repository)

        val settled = viewModel.stations.first { it !is UIState.Loading }

        assertEquals(UIState.Success(listOf("KCI-MRI", "MRTJ-BHI")), settled)
    }
}
