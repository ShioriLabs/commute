package id.shiorilabs.commute.core.datastore

import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test

class AppearancePreferencesRepositoryTest {

    @Test
    fun `follows the phone until a mode is picked, then remembers it`() = runTest {
        val repository = AppearancePreferencesRepository(FakePreferencesDataStore())
        assertEquals(ThemeMode.System, repository.themeMode.first())

        repository.setThemeMode(ThemeMode.Black)

        assertEquals(ThemeMode.Black, repository.themeMode.first())
    }

    @Test
    fun `a mode it does not know is the phone's`() = runTest {
        val store = FakePreferencesDataStore()
        store.edit { it[stringPreferencesKey("theme_mode")] = "Sepia" }

        assertEquals(ThemeMode.System, AppearancePreferencesRepository(store).themeMode.first())
    }
}
