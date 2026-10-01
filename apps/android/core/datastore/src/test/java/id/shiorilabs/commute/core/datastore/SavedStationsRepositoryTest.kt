package id.shiorilabs.commute.core.datastore

import androidx.datastore.preferences.core.preferencesOf
import androidx.datastore.preferences.core.stringPreferencesKey
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test

class SavedStationsRepositoryTest {

    private val key = stringPreferencesKey("saved_stations")

    @Test
    fun `stations is empty when nothing was saved`() = runTest {
        val repository = SavedStationsRepository(FakePreferencesDataStore())

        assertEquals(emptyList<String>(), repository.stations.first())
    }

    @Test
    fun `save keeps the order stations were saved in`() = runTest {
        val repository = SavedStationsRepository(FakePreferencesDataStore())

        repository.save("KCI-MRI")
        repository.save("MRTJ-BHI")

        assertEquals(listOf("KCI-MRI", "MRTJ-BHI"), repository.stations.first())
    }

    @Test
    fun `save ignores a station that is already saved`() = runTest {
        val repository = SavedStationsRepository(FakePreferencesDataStore())

        repository.save("KCI-MRI")
        repository.save("MRTJ-BHI")
        repository.save("KCI-MRI")

        assertEquals(listOf("KCI-MRI", "MRTJ-BHI"), repository.stations.first())
    }

    @Test
    fun `remove drops only the given station`() = runTest {
        val repository = SavedStationsRepository(FakePreferencesDataStore())
        repository.save("KCI-MRI")
        repository.save("MRTJ-BHI")

        repository.remove("KCI-MRI")

        assertEquals(listOf("MRTJ-BHI"), repository.stations.first())
    }

    @Test
    fun `stations is empty when the stored value does not decode`() = runTest {
        val repository = SavedStationsRepository(
            FakePreferencesDataStore(preferencesOf(key to "{not a list")),
        )

        assertEquals(emptyList<String>(), repository.stations.first())
    }

    @Test
    fun `toggle saves an unsaved station at the end and unsaves a saved one`() = runTest {
        val repository = SavedStationsRepository(FakePreferencesDataStore())
        repository.save("KCI-MRI")

        repository.toggle("MRTJ-BHI")
        assertEquals(listOf("KCI-MRI", "MRTJ-BHI"), repository.stations.first())

        repository.toggle("KCI-MRI")
        assertEquals(listOf("MRTJ-BHI"), repository.stations.first())
    }
}
