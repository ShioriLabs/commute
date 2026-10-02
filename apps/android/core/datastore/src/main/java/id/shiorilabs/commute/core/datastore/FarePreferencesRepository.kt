package id.shiorilabs.commute.core.datastore

import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import id.shiorilabs.commute.core.datastore.qualifier.FarePreferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import javax.inject.Inject
import javax.inject.Singleton

/**
 * The OTW search's settings as stored: raw strings, exactly as the web's `fare-criteria` key holds
 * them. Validating them is the journey feature's job, field by field, so one value this version
 * does not know resets only itself.
 */
@Serializable
data class StoredFareCriteria(
    val paymentMethod: String? = null,
    /** `now`, or the ISO instant the rider picked. */
    val fareTime: String? = null,
    val modes: String? = null,
    val walking: String? = null,
)

/**
 * The OTW search's standing settings and the stations the rider last picked in it. The port of the
 * web's `fare-criteria` and `fare-recent-stations` storage keys.
 */
@Singleton
class FarePreferencesRepository @Inject constructor(
    @FarePreferencesDataStore private val dataStore: DataStore<Preferences>,
) {

    private val json = Json { ignoreUnknownKeys = true }

    /** `null` until the rider changes a setting: the caller's defaults apply. */
    val criteria: Flow<StoredFareCriteria?> = dataStore.data.map { prefs ->
        prefs[CRITERIA_KEY]?.let { raw -> runCatching { json.decodeFromString<StoredFareCriteria>(raw) }.getOrNull() }
    }

    /** Station ids, newest first. */
    val recentStationIds: Flow<List<String>> = dataStore.data.map { prefs ->
        prefs[RECENT_STATIONS_KEY]?.let { raw -> runCatching { json.decodeFromString<List<String>>(raw) }.getOrNull() }
            .orEmpty()
    }

    suspend fun saveCriteria(criteria: StoredFareCriteria) {
        dataStore.edit { prefs ->
            prefs[CRITERIA_KEY] = json.encodeToString(criteria)
        }
    }

    /** Moves [stationId] to the front, as the web's `recordRecentPick` does, keeping [MAX_RECENT_STATIONS]. */
    suspend fun recordStation(stationId: String) {
        dataStore.edit { prefs ->
            val current = prefs[RECENT_STATIONS_KEY]
                ?.let { raw -> runCatching { json.decodeFromString<List<String>>(raw) }.getOrNull() }
                .orEmpty()
            val next = (listOf(stationId) + current.filterNot { it == stationId }).take(MAX_RECENT_STATIONS)
            prefs[RECENT_STATIONS_KEY] = json.encodeToString(next)
        }
    }

    companion object {

        /** `RECENT_PICKS_MAX` on the web: the picker's quick-pick rail holds four. */
        const val MAX_RECENT_STATIONS = 4

        private val CRITERIA_KEY = stringPreferencesKey("fare_criteria")
        private val RECENT_STATIONS_KEY = stringPreferencesKey("fare_recent_stations")
    }
}
