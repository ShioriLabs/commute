package id.shiorilabs.commute.core.datastore

import androidx.datastore.preferences.core.preferencesOf
import androidx.datastore.preferences.core.stringPreferencesKey
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class FarePreferencesRepositoryTest {

    @Test
    fun `criteria are null until saved, then read back`() = runTest {
        val repository = FarePreferencesRepository(FakePreferencesDataStore())
        assertNull(repository.criteria.first())

        val saved = StoredFareCriteria(paymentMethod = "QRIS_TAP", fareTime = "now", modes = "rail", walking = "SLOW")
        repository.saveCriteria(saved)

        assertEquals(saved, repository.criteria.first())
    }

    @Test
    fun `the criteria last read or saved are offered without reading the disk`() = runTest {
        val repository = FarePreferencesRepository(FakePreferencesDataStore())
        assertNull(repository.cachedCriteria())

        repository.criteria.first()
        assertEquals(CriteriaSnapshot(null), repository.cachedCriteria())

        repository.saveCriteria(StoredFareCriteria(paymentMethod = "QRIS_TAP"))
        assertEquals(CriteriaSnapshot(StoredFareCriteria(paymentMethod = "QRIS_TAP")), repository.cachedCriteria())
    }

    @Test
    fun `unreadable stored criteria read as none`() = runTest {
        val store = FakePreferencesDataStore(preferencesOf(stringPreferencesKey("fare_criteria") to "{not json"))

        assertNull(FarePreferencesRepository(store).criteria.first())
    }

    @Test
    fun `a picked station moves to the front and the list keeps four`() = runTest {
        val repository = FarePreferencesRepository(FakePreferencesDataStore())
        listOf("A", "B", "C", "D", "E").forEach { repository.recordStation(it) }

        repository.recordStation("C")

        assertEquals(listOf("C", "E", "D", "B"), repository.recentStationIds.first())
    }

    @Test
    fun `a checked pair moves to the front, once, and the list keeps five`() = runTest {
        val repository = FarePreferencesRepository(FakePreferencesDataStore())

        repository.recordRoute("A", "B")
        repository.recordRoute("B", "A")
        repository.recordRoute("A", "B")
        assertEquals(listOf(RecentRoute("A", "B"), RecentRoute("B", "A")), repository.recentRoutes.first())

        (1..10).forEach { repository.recordRoute("S$it", "X") }
        assertEquals(5, repository.recentRoutes.first().size)
        assertEquals(RecentRoute("S10", "X"), repository.recentRoutes.first().first())
    }

    @Test
    fun `clearing recent pairs leaves the picked stations`() = runTest {
        val repository = FarePreferencesRepository(FakePreferencesDataStore())
        repository.recordStation("A")
        repository.recordRoute("A", "B")

        repository.clearRecentRoutes()

        assertEquals(emptyList<RecentRoute>(), repository.recentRoutes.first())
        assertEquals(listOf("A"), repository.recentStationIds.first())
    }

    @Test
    fun `unreadable stored pairs read as none`() = runTest {
        val store = FakePreferencesDataStore(preferencesOf(stringPreferencesKey("fare_recent_routes") to "{bad"))

        assertEquals(emptyList<RecentRoute>(), FarePreferencesRepository(store).recentRoutes.first())
    }
}
