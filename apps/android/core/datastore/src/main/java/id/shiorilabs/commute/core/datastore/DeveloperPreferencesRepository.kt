package id.shiorilabs.commute.core.datastore

import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import id.shiorilabs.commute.core.datastore.qualifier.DeveloperDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Switches for trying the app out, on the Experimental page of settings: always there in a debug
 * build, and in any other once the app's version under settings has been tapped seven times.
 */
@Singleton
class DeveloperPreferencesRepository @Inject constructor(
    @DeveloperDataStore private val dataStore: DataStore<Preferences>,
) {

    /** The version was tapped seven times: settings list the Experimental page. */
    val experimentalUnlocked: Flow<Boolean> = dataStore.data.map { it[EXPERIMENTAL_UNLOCKED] == true }

    /** "Paksa OTW": any journey can start, however far off its train is. */
    val forceTripStart: Flow<Boolean> = dataStore.data.map { it[FORCE_TRIP_START] == true }

    /** The floating frost tuner over every screen, for the pinned headers' frost. */
    val frostTuner: Flow<Boolean> = dataStore.data.map { it[FROST_TUNER] == true }

    /** "Tandai manual": buttons on the trip page for the rider to mark what the train is doing. */
    val manualMarks: Flow<Boolean> = dataStore.data.map { it[MANUAL_MARKS] == true }

    suspend fun setExperimentalUnlocked(unlocked: Boolean) = set(EXPERIMENTAL_UNLOCKED, unlocked)

    suspend fun setForceTripStart(enabled: Boolean) = set(FORCE_TRIP_START, enabled)

    suspend fun setFrostTuner(enabled: Boolean) = set(FROST_TUNER, enabled)

    suspend fun setManualMarks(enabled: Boolean) = set(MANUAL_MARKS, enabled)

    private suspend fun set(key: Preferences.Key<Boolean>, value: Boolean) {
        dataStore.edit { it[key] = value }
    }

    private companion object {

        val EXPERIMENTAL_UNLOCKED = booleanPreferencesKey("experimental_unlocked")
        val FORCE_TRIP_START = booleanPreferencesKey("force_trip_start")
        val FROST_TUNER = booleanPreferencesKey("frost_tuner")
        val MANUAL_MARKS = booleanPreferencesKey("manual_marks")
    }
}
