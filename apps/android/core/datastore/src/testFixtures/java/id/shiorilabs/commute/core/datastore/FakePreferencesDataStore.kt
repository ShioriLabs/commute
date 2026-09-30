package id.shiorilabs.commute.core.datastore

import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.emptyPreferences
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow

/**
 * In-memory [DataStore]<[Preferences]> for unit tests — no Android, no disk. Backed by a
 * [MutableStateFlow] so [data] always emits the latest snapshot and `edit { }` (which routes
 * through [updateData]) mutates it synchronously under `runTest`.
 *
 * Seed a starting state via [initial] to exercise reads of pre-existing / corrupt values.
 */
class FakePreferencesDataStore(
    initial: Preferences = emptyPreferences(),
) : DataStore<Preferences> {

    private val flow = MutableStateFlow(initial)

    override val data: Flow<Preferences> = flow

    override suspend fun updateData(
        transform: suspend (t: Preferences) -> Preferences,
    ): Preferences {
        val updated = transform(flow.value)
        flow.value = updated
        return updated
    }
}
