package id.shiorilabs.commute.core.datastore

import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import id.shiorilabs.commute.core.datastore.qualifier.AppearanceDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import javax.inject.Inject
import javax.inject.Singleton

/** The look the rider picked: the phone's own setting, or one of the app's three. */
enum class ThemeMode {
    /** Follow the phone's night setting: [Light] by day, [Dark] by night, never [Black]. */
    System,
    Light,

    /** The JakLingko navy. */
    Dark,

    /** Pure black, for OLED screens. */
    Black,
}

/** Pengaturan → Tema: which [ThemeMode] the app wears. */
@Singleton
class AppearancePreferencesRepository @Inject constructor(
    @AppearanceDataStore private val dataStore: DataStore<Preferences>,
) {

    /** Anything unreadable, an unset key or a mode from a later version, is [ThemeMode.System]. */
    val themeMode: Flow<ThemeMode> = dataStore.data.map { prefs ->
        ThemeMode.entries.firstOrNull { it.name == prefs[THEME_MODE] } ?: ThemeMode.System
    }

    suspend fun setThemeMode(mode: ThemeMode) {
        dataStore.edit { it[THEME_MODE] = mode.name }
    }

    private companion object {

        val THEME_MODE = stringPreferencesKey("theme_mode")
    }
}
