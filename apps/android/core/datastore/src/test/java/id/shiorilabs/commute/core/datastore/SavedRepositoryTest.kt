package id.shiorilabs.commute.core.datastore

import androidx.datastore.preferences.core.preferencesOf
import androidx.datastore.preferences.core.stringPreferencesKey
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test

class SavedRepositoryTest {

    private val key = stringPreferencesKey("saved_entries")

    private val manggarai = SavedEntry.Station("KCI-MRI")
    private val bundaranHi = SavedEntry.Station("MRTJ-BHI")
    private val toWork = SavedEntry.Route("KCI-BOO", "KCI-SUD")
    private val home = SavedEntry.Route("KCI-SUD", "KCI-BOO")

    @Test
    fun `nothing is pinned to begin with`() = runTest {
        val repository = SavedRepository(FakePreferencesDataStore())

        assertEquals(emptyList<SavedEntry>(), repository.entries.first())
        assertEquals(emptyList<String>(), repository.stationIds.first())
    }

    @Test
    fun `stations and pairs share one list, in the order they were pinned`() = runTest {
        val repository = SavedRepository(FakePreferencesDataStore())

        repository.toggleStation("KCI-MRI")
        repository.toggleRoute("KCI-BOO", "KCI-SUD")
        repository.toggleStation("MRTJ-BHI")

        assertEquals(listOf(manggarai, toWork, bundaranHi), repository.entries.first())
        assertEquals(listOf("KCI-MRI", "MRTJ-BHI"), repository.stationIds.first())
    }

    @Test
    fun `a pair is directional`() = runTest {
        val repository = SavedRepository(FakePreferencesDataStore())

        repository.toggleRoute("KCI-BOO", "KCI-SUD")
        repository.toggleRoute("KCI-SUD", "KCI-BOO")
        assertEquals(listOf(toWork, home), repository.entries.first())

        repository.toggleRoute("KCI-BOO", "KCI-SUD")
        assertEquals(listOf(home), repository.entries.first())
    }

    @Test
    fun `toggling a station leaves the pairs alone`() = runTest {
        val repository = SavedRepository(FakePreferencesDataStore())
        repository.toggleRoute("KCI-BOO", "KCI-SUD")

        repository.toggleStation("KCI-MRI")
        repository.toggleStation("KCI-MRI")

        assertEquals(listOf(toWork), repository.entries.first())
    }

    @Test
    fun `a new pin goes to the end`() = runTest {
        val repository = SavedRepository(FakePreferencesDataStore())
        repository.toggleStation("KCI-MRI")
        repository.toggleStation("MRTJ-BHI")
        repository.toggleStation("KCI-MRI")

        repository.toggleStation("KCI-MRI")

        assertEquals(listOf(bundaranHi, manggarai), repository.entries.first())
    }

    @Test
    fun `replace stores the list in the given order, once each`() = runTest {
        val repository = SavedRepository(FakePreferencesDataStore())

        repository.replace(listOf(toWork, manggarai, toWork))

        assertEquals(listOf(toWork, manggarai), repository.entries.first())
    }

    @Test
    fun `a stored list that does not decode reads as empty`() = runTest {
        val repository = SavedRepository(FakePreferencesDataStore(preferencesOf(key to "{not a list")))

        assertEquals(emptyList<SavedEntry>(), repository.entries.first())
    }

    @Test
    fun `entries survive a round trip through storage`() = runTest {
        val store = FakePreferencesDataStore()
        SavedRepository(store).replace(listOf(manggarai, toWork))

        assertEquals(listOf(manggarai, toWork), SavedRepository(store).entries.first())
    }

    @Test
    fun `clear forgets every pin`() = runTest {
        val repository = SavedRepository(FakePreferencesDataStore())
        repository.toggleStation("KCI-MRI")
        repository.toggleRoute("KCI-BOO", "KCI-SUD")

        repository.clear()

        assertEquals(emptyList<SavedEntry>(), repository.entries.first())
    }
}
