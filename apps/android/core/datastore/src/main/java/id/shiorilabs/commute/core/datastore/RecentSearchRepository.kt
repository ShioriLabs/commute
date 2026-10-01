package id.shiorilabs.commute.core.datastore

import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import id.shiorilabs.commute.core.datastore.qualifier.RecentSearchesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import javax.inject.Inject
import javax.inject.Singleton

/**
 * A place the rider opened from search: a station by its id (`KCI-MRI`) or a hub by its slug.
 * Lines are not recorded, as on the web.
 */
@Serializable
data class RecentSearch(
    val type: Type,
    val id: String,
) {

    enum class Type { STATION, HUB }
}

/**
 * The places the rider last opened from search, newest first, for the search screen's "Terakhir
 * dicari" list. The same rule as the web's `utils/recents.ts`: capped at [MAX_ENTRIES], and
 * opening one already present moves it to the front.
 */
@Singleton
class RecentSearchRepository @Inject constructor(
    @RecentSearchesDataStore private val dataStore: DataStore<Preferences>,
) {

    val recents: Flow<List<RecentSearch>> = dataStore.data.map { prefs ->
        decode(prefs[RECENTS_KEY])
    }

    suspend fun record(entry: RecentSearch) {
        dataStore.edit { prefs ->
            val rest = decode(prefs[RECENTS_KEY]).filterNot { it == entry }
            prefs[RECENTS_KEY] = Json.encodeToString((listOf(entry) + rest).take(MAX_ENTRIES))
        }
    }

    /** Forgets every recent search: the "Hapus" beside the list. */
    suspend fun clear() {
        dataStore.edit { prefs ->
            prefs.remove(RECENTS_KEY)
        }
    }

    private fun decode(raw: String?): List<RecentSearch> {
        if (raw.isNullOrBlank()) {
            return emptyList()
        }
        return runCatching { Json.decodeFromString<List<RecentSearch>>(raw) }.getOrDefault(emptyList())
    }

    private companion object {

        const val MAX_ENTRIES = 8

        val RECENTS_KEY = stringPreferencesKey("recent_searches")
    }
}
