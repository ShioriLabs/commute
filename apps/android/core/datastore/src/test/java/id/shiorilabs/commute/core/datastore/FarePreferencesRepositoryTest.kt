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
}
