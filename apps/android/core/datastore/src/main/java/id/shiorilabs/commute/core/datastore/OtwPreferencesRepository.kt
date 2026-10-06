package id.shiorilabs.commute.core.datastore

import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import id.shiorilabs.commute.core.datastore.qualifier.OtwDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import javax.inject.Inject
import javax.inject.Singleton

/** How the trip page shows a trip under way (Pengaturan → OTW). */
@Singleton
class OtwPreferencesRepository @Inject constructor(
    @OtwDataStore private val dataStore: DataStore<Preferences>,
) {

    /** "Diagram ala Layar Kereta Jepang": the board draws the stops ahead on a curved strip under its plate. On until switched off. */
    val pidsDiagram: Flow<Boolean> = dataStore.data.map { prefs -> (prefs[PIDS_DIAGRAM] != false).also { cachedPidsDiagram = it } }

    /**
     * The last [pidsDiagram] read, `null` until it first is: the trip page starts from it, so a
     * board with the diagram off doesn't draw it for the frame or two the disk takes.
     */
    @Volatile
    var cachedPidsDiagram: Boolean? = null
        private set

    suspend fun setPidsDiagram(enabled: Boolean) {
        dataStore.edit { it[PIDS_DIAGRAM] = enabled }
    }

    private companion object {

        val PIDS_DIAGRAM = booleanPreferencesKey("pids_diagram")
    }
}
