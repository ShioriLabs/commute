package id.shiorilabs.commute.core.datastore

import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.MutablePreferences
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import id.shiorilabs.commute.core.datastore.qualifier.SavedDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Something the rider pinned to the home screen: a station, or a Dari→Ke pair. A pair is
 * directional, so the morning trip and the evening one are two entries.
 */
@Serializable
sealed interface SavedEntry {

    @Serializable
    @SerialName("station")
    data class Station(
        /** `OPERATOR-CODE`, e.g. `KCI-MRI`. */
        val stationId: String,
    ) : SavedEntry

    @Serializable
    @SerialName("route")
    data class Route(
        /** `OPERATOR-CODE`. */
        val fromId: String,
        val toId: String,
    ) : SavedEntry
}

/**
 * The stations and pairs the rider pinned, in one list in their own order: the home screen renders
 * them as one feed, as the web keeps both in one `saved-stations` list.
 *
 * Stored as one JSON list of tagged entries (`{"type":"station","stationId":"KCI-MRI"}`). Content
 * that doesn't decode reads as an empty list, as it does on the web.
 */
@Singleton
class SavedRepository @Inject constructor(
    @SavedDataStore private val dataStore: DataStore<Preferences>,
) {

    /** The list as last read or written this session, for [cachedEntries]. */
    @Volatile
    private var snapshot: List<SavedEntry>? = null

    val entries: Flow<List<SavedEntry>> = dataStore.data.map { prefs ->
        decode(prefs[ENTRIES_KEY]).also { snapshot = it }
    }

    /**
     * [entries] as last read or written this session, without reading the disk: for home to build
     * its first frame from. Null until the list has been read once.
     */
    fun cachedEntries(): List<SavedEntry>? = snapshot

    /** The pinned stations alone, in order: the station page's pin and search's. */
    val stationIds: Flow<List<String>> = entries
        .map { entries -> entries.filterIsInstance<SavedEntry.Station>().map { it.stationId } }
        .distinctUntilChanged()

    /** Pins [stationId], or unpins it if it is pinned. A new pin goes to the end. */
    suspend fun toggleStation(stationId: String) = toggle(SavedEntry.Station(stationId))

    /** Pins the pair from [fromId] to [toId], or unpins it. The reverse pair is another entry. */
    suspend fun toggleRoute(fromId: String, toId: String) = toggle(SavedEntry.Route(fromId, toId))

    /**
     * Stores [entries] as the list, in that order: the settings page's reorder and unpin, which edit
     * the whole list at once.
     */
    suspend fun replace(entries: List<SavedEntry>) = write { prefs ->
        prefs[ENTRIES_KEY] = encode(entries.distinct())
    }

    /** Forgets every pin. */
    suspend fun clear() = write { prefs ->
        prefs.remove(ENTRIES_KEY)
    }

    private suspend fun toggle(entry: SavedEntry) = write { prefs ->
        val current = decode(prefs[ENTRIES_KEY])
        prefs[ENTRIES_KEY] = encode(if (entry in current) current - entry else current + entry)
    }

    /** Edits the stored list, and keeps [snapshot] to what was written. */
    private suspend fun write(transform: (MutablePreferences) -> Unit) {
        val written = dataStore.edit { prefs -> transform(prefs) }
        snapshot = decode(written[ENTRIES_KEY])
    }

    private fun encode(entries: List<SavedEntry>): String = JSON.encodeToString(entries)

    private fun decode(raw: String?): List<SavedEntry> {
        if (raw.isNullOrBlank()) {
            return emptyList()
        }
        return runCatching { JSON.decodeFromString<List<SavedEntry>>(raw) }.getOrDefault(emptyList())
    }

    private companion object {

        val JSON = Json { ignoreUnknownKeys = true }

        val ENTRIES_KEY = stringPreferencesKey("saved_entries")
    }
}
