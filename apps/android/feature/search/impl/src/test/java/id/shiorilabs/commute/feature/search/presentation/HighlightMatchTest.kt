package id.shiorilabs.commute.feature.search.presentation

import androidx.compose.ui.graphics.Color
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class HighlightMatchTest {

    @Test
    fun `colours the first case-insensitive occurrence`() {
        val result = "Manggarai".highlightMatch("GGA", Color.Red)

        val span = result.spanStyles.single()
        assertEquals(Color.Red, span.item.color)
        assertEquals("gga", result.text.substring(span.start, span.end))
    }

    @Test
    fun `a typo match renders plain`() {
        assertTrue("Dukuh Atas".highlightMatch("dukuj", Color.Red).spanStyles.isEmpty())
    }
}
