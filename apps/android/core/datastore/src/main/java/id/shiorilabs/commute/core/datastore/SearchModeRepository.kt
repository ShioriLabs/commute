package id.shiorilabs.commute.core.datastore

import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import id.shiorilabs.commute.core.datastore.qualifier.SearchModeDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import javax.inject.Inject
import javax.inject.Singleton

/** The two halves of search: one station, or a trip between two (OTW). */
enum class SearchMode { STATION, FARE }

/**
 * Which half of search the rider was last in, so someone who mostly checks fares lands on OTW
 * without choosing it every time. The web's `search-mode` storage key.
 */
@Singleton
class SearchModeRepository @Inject constructor(
    @SearchModeDataStore private val dataStore: DataStore<Preferences>,
) {

    val mode: Flow<SearchMode> = dataStore.data.map { prefs ->
        if (prefs[MODE_KEY] == SearchMode.FARE.name) SearchMode.FARE else SearchMode.STATION
    }

    suspend fun setMode(mode: SearchMode) {
        dataStore.edit { prefs ->
            prefs[MODE_KEY] = mode.name
        }
    }

    private companion object {

        val MODE_KEY = stringPreferencesKey("search_mode")
    }
}
