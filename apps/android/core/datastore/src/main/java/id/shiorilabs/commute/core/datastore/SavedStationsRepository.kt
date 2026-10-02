package id.shiorilabs.commute.core.datastore

import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import id.shiorilabs.commute.core.datastore.qualifier.SavedStationsDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.serialization.json.Json
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Persists the stations the rider saved, in the order they saved them, for the home screen.
 *
 * Each entry is a station id in the web app's `saved-stations` format: `OPERATOR-CODE`. The list is
 * stored as one JSON string rather than a string set because the order is what the home screen
 * renders. Content that doesn't decode reads as an empty list, as it does on the web.
 */
@Singleton
class SavedStationsRepository @Inject constructor(
    @SavedStationsDataStore private val dataStore: DataStore<Preferences>,
) {

    val stations: Flow<List<String>> = dataStore.data.map { prefs ->
        decode(prefs[STATIONS_KEY])
    }

    /** Appends [stationId] to the saved list; saving a station twice keeps its original position. */
    suspend fun save(stationId: String) {
        dataStore.edit { prefs ->
            val current = decode(prefs[STATIONS_KEY])
            if (stationId !in current) {
                prefs[STATIONS_KEY] = Json.encodeToString(current + stationId)
            }
        }
    }

    suspend fun remove(stationId: String) {
        dataStore.edit { prefs ->
            prefs[STATIONS_KEY] = Json.encodeToString(decode(prefs[STATIONS_KEY]) - stationId)
        }
    }

    /**
     * Saves [stationId] if it isn't saved, unsaves it if it is: the pin on a search result. A newly
     * saved station goes to the end, as with [save].
     */
    suspend fun toggle(stationId: String) {
        dataStore.edit { prefs ->
            val current = decode(prefs[STATIONS_KEY])
            val next = if (stationId in current) current - stationId else current + stationId
            prefs[STATIONS_KEY] = Json.encodeToString(next)
        }
    }

    /**
     * Stores [stationIds] as the saved list, in that order: the settings page's reorder and unpin,
     * which edit the whole list at once.
     */
    suspend fun replace(stationIds: List<String>) {
        dataStore.edit { prefs ->
            prefs[STATIONS_KEY] = Json.encodeToString(stationIds.distinct())
        }
    }

    /** Forgets every saved station. */
    suspend fun clear() {
        dataStore.edit { prefs ->
            prefs.remove(STATIONS_KEY)
        }
    }

    private fun decode(raw: String?): List<String> {
        if (raw.isNullOrBlank()) {
            return emptyList()
        }
        return runCatching { Json.decodeFromString<List<String>>(raw) }.getOrDefault(emptyList())
    }

    private companion object {

        val STATIONS_KEY = stringPreferencesKey("saved_stations")
    }
}
