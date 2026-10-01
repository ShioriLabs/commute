package id.shiorilabs.commute.core.datastore

import androidx.datastore.preferences.core.preferencesOf
import androidx.datastore.preferences.core.stringPreferencesKey
import id.shiorilabs.commute.core.datastore.RecentSearch.Type.HUB
import id.shiorilabs.commute.core.datastore.RecentSearch.Type.STATION
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test

class RecentSearchRepositoryTest {

    @Test
    fun `record puts the newest first`() = runTest {
        val repository = RecentSearchRepository(FakePreferencesDataStore())

        repository.record(RecentSearch(STATION, "KCI-MRI"))
        repository.record(RecentSearch(HUB, "dukuh-atas"))

        assertEquals(
            listOf(RecentSearch(HUB, "dukuh-atas"), RecentSearch(STATION, "KCI-MRI")),
            repository.recents.first(),
        )
    }

    @Test
    fun `recording one already present moves it to the front`() = runTest {
        val repository = RecentSearchRepository(FakePreferencesDataStore())
        repository.record(RecentSearch(STATION, "KCI-MRI"))
        repository.record(RecentSearch(STATION, "KCI-SUD"))

        repository.record(RecentSearch(STATION, "KCI-MRI"))

        assertEquals(
            listOf(RecentSearch(STATION, "KCI-MRI"), RecentSearch(STATION, "KCI-SUD")),
            repository.recents.first(),
        )
    }

    @Test
    fun `a station and a hub with the same id are different entries`() = runTest {
        val repository = RecentSearchRepository(FakePreferencesDataStore())

        repository.record(RecentSearch(STATION, "x"))
        repository.record(RecentSearch(HUB, "x"))

        assertEquals(2, repository.recents.first().size)
    }

    @Test
    fun `keeps only the eight newest`() = runTest {
        val repository = RecentSearchRepository(FakePreferencesDataStore())

        ('A'..'I').forEach { repository.record(RecentSearch(STATION, it.toString())) }

        assertEquals("IHGFEDCB".map { it.toString() }, repository.recents.first().map { it.id })
    }

    @Test
    fun `clear forgets everything`() = runTest {
        val repository = RecentSearchRepository(FakePreferencesDataStore())
        repository.record(RecentSearch(STATION, "KCI-MRI"))

        repository.clear()

        assertEquals(emptyList<RecentSearch>(), repository.recents.first())
    }

    @Test
    fun `reads as empty when the stored value does not decode`() = runTest {
        val repository = RecentSearchRepository(
            FakePreferencesDataStore(preferencesOf(stringPreferencesKey("recent_searches") to "nope")),
        )

        assertEquals(emptyList<RecentSearch>(), repository.recents.first())
    }
}
