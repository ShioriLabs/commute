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
 * A pair the rider checked, the web's `RecentRoute`. Directional, like a saved pair: A→B and B→A
 * are two entries.
 */
@Serializable
data class RecentRoute(
    /** `OPERATOR-CODE`. */
    val fromId: String,
    val toId: String,
)

/**
 * The OTW search's standing settings, the stations the rider last picked in it, and the pairs they
 * last checked. The port of the web's `fare-criteria`, `fare-recent-stations` and `recent-routes`
 * storage keys.
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

    /** Pairs that answered, newest first: search's "Rute terakhir". */
    val recentRoutes: Flow<List<RecentRoute>> = dataStore.data.map { prefs -> decodeRoutes(prefs[RECENT_ROUTES_KEY]) }

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

    /**
     * Moves the pair to the front, keeping [MAX_RECENT_ROUTES]. Called once a pair has answered, not
     * on every pick: a half-made selection or a failed lookup is not a trip worth offering back.
     */
    suspend fun recordRoute(fromId: String, toId: String) {
        val route = RecentRoute(fromId, toId)
        dataStore.edit { prefs ->
            val next = (listOf(route) + decodeRoutes(prefs[RECENT_ROUTES_KEY]).filterNot { it == route })
                .take(MAX_RECENT_ROUTES)
            prefs[RECENT_ROUTES_KEY] = json.encodeToString(next)
        }
    }

    /** Forgets every recent pair: the "Hapus" beside the list, and Manage Data's clear. */
    suspend fun clearRecentRoutes() {
        dataStore.edit { prefs ->
            prefs.remove(RECENT_ROUTES_KEY)
        }
    }

    private fun decodeRoutes(raw: String?): List<RecentRoute> =
        raw?.let { runCatching { json.decodeFromString<List<RecentRoute>>(it) }.getOrNull() }.orEmpty()

    companion object {

        /** `RECENT_PICKS_MAX` on the web: the picker's quick-pick rail holds four. */
        const val MAX_RECENT_STATIONS = 4

        /** The web's `MAX_ROUTE_ENTRIES`. */
        const val MAX_RECENT_ROUTES = 5

        private val CRITERIA_KEY = stringPreferencesKey("fare_criteria")
        private val RECENT_STATIONS_KEY = stringPreferencesKey("fare_recent_stations")
        private val RECENT_ROUTES_KEY = stringPreferencesKey("fare_recent_routes")
    }
}
