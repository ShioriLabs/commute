package id.shiorilabs.commute.core.datastore

import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class OnboardingPreferencesRepositoryTest {

    @Test
    fun `a fresh install hasn't seen the welcome`() = runTest {
        assertFalse(OnboardingPreferencesRepository(FakePreferencesDataStore()).completed.first())
    }

    @Test
    fun `the welcome stays seen once completed`() = runTest {
        val repository = OnboardingPreferencesRepository(FakePreferencesDataStore())

        repository.complete()

        assertTrue(repository.completed.first())
    }
}
