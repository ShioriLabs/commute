package id.shiorilabs.commute.core.datastore

import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import id.shiorilabs.commute.core.datastore.qualifier.LocationDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import javax.inject.Inject
import javax.inject.Singleton

/**
 * What the rider lets the app use their location for, as set in Pengaturan → Lokasi. Every use is on
 * until turned off, under one switch for all of them. This only ever narrows what the system's own
 * permission allows: with the permission refused, nothing here turns location back on.
 *
 * @property enabled The switch over all of them.
 * @property homeNearby "Di dekat kamu" on home.
 * @property pickerNearby "Pakai lokasi kamu" when picking a trip's start or end.
 * @property tripFixes Fixes along the way in trip mode; without them a trip runs by the clock.
 */
data class LocationUse(
    val enabled: Boolean = true,
    val homeNearby: Boolean = true,
    val pickerNearby: Boolean = true,
    val tripFixes: Boolean = true,
) {

    val allowsHomeNearby: Boolean get() = enabled && homeNearby
    val allowsPickerNearby: Boolean get() = enabled && pickerNearby
    val allowsTripFixes: Boolean get() = enabled && tripFixes
}

@Singleton
class LocationPreferencesRepository @Inject constructor(
    @LocationDataStore private val dataStore: DataStore<Preferences>,
) {

    val use: Flow<LocationUse> = dataStore.data.map {
        LocationUse(
            enabled = it[ENABLED] != false,
            homeNearby = it[HOME_NEARBY] != false,
            pickerNearby = it[PICKER_NEARBY] != false,
            tripFixes = it[TRIP_FIXES] != false,
        )
    }

    /** The switch over every use; each keeps its own setting under it, for when it comes back on. */
    suspend fun setEnabled(enabled: Boolean) = set(ENABLED, enabled)

    suspend fun setHomeNearby(enabled: Boolean) = set(HOME_NEARBY, enabled)

    suspend fun setPickerNearby(enabled: Boolean) = set(PICKER_NEARBY, enabled)

    suspend fun setTripFixes(enabled: Boolean) = set(TRIP_FIXES, enabled)

    private suspend fun set(key: Preferences.Key<Boolean>, value: Boolean) {
        dataStore.edit { it[key] = value }
    }

    private companion object {

        val ENABLED = booleanPreferencesKey("location_enabled")
        val HOME_NEARBY = booleanPreferencesKey("location_home_nearby")
        val PICKER_NEARBY = booleanPreferencesKey("location_picker_nearby")
        val TRIP_FIXES = booleanPreferencesKey("location_trip_fixes")
    }
}
