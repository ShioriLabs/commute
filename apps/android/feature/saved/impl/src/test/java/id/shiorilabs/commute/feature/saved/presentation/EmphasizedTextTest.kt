package id.shiorilabs.commute.feature.saved.presentation

import androidx.compose.ui.text.font.FontWeight
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class EmphasizedTextTest {

    @Test
    fun `withBold keeps the text and bolds only the given part`() {
        val result = "Klik tombol Mau ke mana? di bawah".withBold("Mau ke mana?")

        assertEquals("Klik tombol Mau ke mana? di bawah", result.text)
        val span = result.spanStyles.single()
        assertEquals(FontWeight.Bold, span.item.fontWeight)
        assertEquals("Mau ke mana?", result.text.substring(span.start, span.end))
    }

    @Test
    fun `withBold leaves the text unstyled when the part is absent`() {
        val result = "Klik tombol di bawah".withBold("Mau ke mana?")

        assertEquals("Klik tombol di bawah", result.text)
        assertTrue(result.spanStyles.isEmpty())
    }

    @Test
    fun `withBold leaves the text unstyled when the part is empty`() {
        assertTrue("Klik tombol di bawah".withBold("").spanStyles.isEmpty())
    }
}
