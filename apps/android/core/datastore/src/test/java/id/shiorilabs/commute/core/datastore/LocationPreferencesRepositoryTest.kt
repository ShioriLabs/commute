package id.shiorilabs.commute.core.datastore

import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class LocationPreferencesRepositoryTest {

    @Test
    fun `every use is on until turned off`() = runTest {
        val use = LocationPreferencesRepository(FakePreferencesDataStore()).use.first()

        assertEquals(LocationUse(), use)
        assertTrue(use.allowsHomeNearby && use.allowsPickerNearby && use.allowsTripFixes)
    }

    @Test
    fun `one use off leaves the others on`() = runTest {
        val repository = LocationPreferencesRepository(FakePreferencesDataStore())

        repository.setTripFixes(false)
        val use = repository.use.first()

        assertFalse(use.allowsTripFixes)
        assertTrue(use.allowsHomeNearby && use.allowsPickerNearby)
    }

    @Test
    fun `the main switch turns every use off, and back on as each was`() = runTest {
        val repository = LocationPreferencesRepository(FakePreferencesDataStore())
        repository.setHomeNearby(false)

        repository.setEnabled(false)
        val off = repository.use.first()
        assertFalse(off.allowsHomeNearby || off.allowsPickerNearby || off.allowsTripFixes)

        repository.setEnabled(true)
        val on = repository.use.first()
        assertFalse(on.allowsHomeNearby)
        assertTrue(on.allowsPickerNearby && on.allowsTripFixes)
    }
}
