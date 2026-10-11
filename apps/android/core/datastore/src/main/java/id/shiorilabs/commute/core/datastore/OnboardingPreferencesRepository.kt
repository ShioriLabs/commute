package id.shiorilabs.commute.core.datastore

import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import id.shiorilabs.commute.core.datastore.qualifier.OnboardingDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import javax.inject.Inject
import javax.inject.Singleton

/** What the rider has been shown on first open. */
@Singleton
class OnboardingPreferencesRepository @Inject constructor(
    @OnboardingDataStore private val dataStore: DataStore<Preferences>,
) {

    /**
     * The rider went past the closed test's welcome page: the app opens on home from here on. A
     * later first-run page takes a key of its own, so riders who saw this one still see that.
     */
    val completed: Flow<Boolean> = dataStore.data.map { it[CLOSED_TEST_WELCOME_SEEN] == true }

    suspend fun complete() {
        dataStore.edit { it[CLOSED_TEST_WELCOME_SEEN] = true }
    }

    private companion object {

        val CLOSED_TEST_WELCOME_SEEN = booleanPreferencesKey("closed_test_welcome_seen")
    }
}
