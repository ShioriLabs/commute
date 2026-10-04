package id.shiorilabs.commute.core.datastore

import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import id.shiorilabs.commute.core.datastore.qualifier.HomeDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import javax.inject.Inject
import javax.inject.Singleton

/** Home's own settings. */
@Singleton
class HomePreferencesRepository @Inject constructor(
    @HomeDataStore private val dataStore: DataStore<Preferences>,
) {

    /** The rider closed the "Lihat stasiun terdekat" card: home stops offering it. */
    val nearbyPromptDismissed: Flow<Boolean> = dataStore.data.map { it[NEARBY_PROMPT_DISMISSED] == true }

    suspend fun dismissNearbyPrompt() {
        dataStore.edit { it[NEARBY_PROMPT_DISMISSED] = true }
    }

    private companion object {

        val NEARBY_PROMPT_DISMISSED = booleanPreferencesKey("nearby_prompt_dismissed")
    }
}
