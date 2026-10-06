package id.shiorilabs.commute.core.datastore

import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class OtwPreferencesRepositoryTest {

    @Test
    fun `the PIDS diagram is on until turned off`() = runTest {
        val repository = OtwPreferencesRepository(FakePreferencesDataStore())
        assertTrue(repository.pidsDiagram.first())

        repository.setPidsDiagram(false)
        assertFalse(repository.pidsDiagram.first())

        repository.setPidsDiagram(true)
        assertTrue(repository.pidsDiagram.first())
    }
}
