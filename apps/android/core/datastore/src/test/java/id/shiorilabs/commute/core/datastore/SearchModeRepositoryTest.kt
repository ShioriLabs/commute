package id.shiorilabs.commute.core.datastore

import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test

class SearchModeRepositoryTest {

    @Test
    fun `defaults to one station, then remembers OTW`() = runTest {
        val repository = SearchModeRepository(FakePreferencesDataStore())
        assertEquals(SearchMode.STATION, repository.mode.first())

        repository.setMode(SearchMode.FARE)

        assertEquals(SearchMode.FARE, repository.mode.first())
    }
}
