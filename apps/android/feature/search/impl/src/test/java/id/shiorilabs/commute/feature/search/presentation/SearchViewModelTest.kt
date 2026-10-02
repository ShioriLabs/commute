package id.shiorilabs.commute.feature.search.presentation

import arrow.core.Either
import arrow.core.left
import arrow.core.right
import id.shiorilabs.commute.core.datastore.FakePreferencesDataStore
import id.shiorilabs.commute.core.datastore.RecentSearch
import id.shiorilabs.commute.core.datastore.RecentSearchRepository
import id.shiorilabs.commute.core.datastore.SavedStationsRepository
import id.shiorilabs.commute.core.datastore.SearchModeRepository
import id.shiorilabs.commute.core.type.Failure
import id.shiorilabs.commute.core.type.UIState
import id.shiorilabs.commute.feature.search.data.SearchRepository
import id.shiorilabs.commute.feature.search.domain.Searchable
import id.shiorilabs.commute.feature.search.line
import id.shiorilabs.commute.feature.search.station
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.first
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
class SearchViewModelTest {

    private val manggarai = station("Manggarai", "KCI-MRI")
    private val cikarang = line("Lin Cikarang")

    private class FakeSearchRepository(var result: Either<Failure, List<Searchable>>) : SearchRepository {
        var calls = 0
        override suspend fun searchables(): Either<Failure, List<Searchable>> {
            calls++
            return result
        }
    }

    private val recents = RecentSearchRepository(FakePreferencesDataStore())
    private val saved = SavedStationsRepository(FakePreferencesDataStore())

    @Before
    fun setUp() {
        Dispatchers.setMain(UnconfinedTestDispatcher())
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    private fun viewModel(repository: SearchRepository) =
        SearchViewModel(repository, recents, saved, SearchModeRepository(FakePreferencesDataStore()))

    private suspend fun SearchViewModel.settled() = state.first { it !is UIState.Loading && it !is UIState.Idle }

    private suspend fun SearchViewModel.resultsFor(query: String): SearchResults {
        onQueryChange(query)
        return state.first {
            val results = (it as? UIState.Success)?.data?.results
            when (results) {
                is SearchResults.Found -> results.query == query
                is SearchResults.NotFound -> results.query == query
                else -> query.length < 2
            }
        }.let { (it as UIState.Success).data.results }
    }

    @Test
    fun `a short query shows the idle state`() = runTest {
        val vm = viewModel(FakeSearchRepository(listOf(manggarai, cikarang).right()))

        assertEquals(SearchResults.None, vm.resultsFor("m"))
    }

    @Test
    fun `a matching query ranks results`() = runTest {
        val vm = viewModel(FakeSearchRepository(listOf(manggarai, cikarang).right()))

        assertEquals(SearchResults.Found("mangga", listOf(manggarai)), vm.resultsFor("mangga"))
    }

    @Test
    fun `a query matching nothing is NotFound`() = runTest {
        val vm = viewModel(FakeSearchRepository(listOf(manggarai).right()))

        assertEquals(SearchResults.NotFound("zzzz"), vm.resultsFor("zzzz"))
    }

    @Test
    fun `a failed load is an Error, and retry loads again`() = runTest {
        val repository = FakeSearchRepository(Failure.Network.NoConnection().left())
        val vm = viewModel(repository)

        assertTrue(vm.settled() is UIState.Error)

        repository.result = listOf(manggarai).right()
        vm.retry()

        assertTrue(vm.settled() is UIState.Success)
        assertEquals(2, repository.calls)
    }

    @Test
    fun `opening a station records it as recent, a line does not`() = runTest {
        val vm = viewModel(FakeSearchRepository(listOf(manggarai, cikarang).right()))

        vm.onResultClick(cikarang)
        vm.onResultClick(manggarai)

        assertEquals(listOf(RecentSearch(RecentSearch.Type.STATION, "KCI-MRI")), recents.recents.first())
    }

    @Test
    fun `the pin toggles a saved station, and the state follows`() = runTest {
        val vm = viewModel(FakeSearchRepository(listOf(manggarai).right()))

        vm.onToggleSave("KCI-MRI")
        val pinned = vm.state.first {
            (it as? UIState.Success)?.data?.savedStationIds?.contains("KCI-MRI") == true
        } as UIState.Success

        assertEquals(listOf(manggarai), pinned.data.idle.saved)

        vm.onToggleSave("KCI-MRI")
        assertEquals(emptyList<String>(), saved.stations.first())
    }

    @Test
    fun `clearing recents empties the list`() = runTest {
        val vm = viewModel(FakeSearchRepository(listOf(manggarai).right()))
        vm.onResultClick(manggarai)

        vm.onClearRecents()

        assertEquals(emptyList<RecentSearch>(), recents.recents.first())
    }
}
