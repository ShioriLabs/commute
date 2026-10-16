package id.shiorilabs.commute.core.ui.theme

import id.shiorilabs.commute.core.datastore.ThemeMode
import org.junit.Assert.assertEquals
import org.junit.Test

class ThemeResolveTest {

    @Test
    fun `the system mode follows the phone's night setting, to light or dark and never black`() {
        assertEquals(ThemeLook.Light, ThemeMode.System.resolve(systemDark = false))
        assertEquals(ThemeLook.Dark, ThemeMode.System.resolve(systemDark = true))
    }

    @Test
    fun `a picked mode ignores the phone`() {
        for (systemDark in listOf(false, true)) {
            assertEquals(ThemeLook.Light, ThemeMode.Light.resolve(systemDark))
            assertEquals(ThemeLook.Dark, ThemeMode.Dark.resolve(systemDark))
            assertEquals(ThemeLook.Black, ThemeMode.Black.resolve(systemDark))
        }
    }
}
