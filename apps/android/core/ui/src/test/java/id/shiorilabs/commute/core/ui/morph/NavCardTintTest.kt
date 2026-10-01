package id.shiorilabs.commute.core.ui.morph

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class NavCardTintTest {

    @Test
    fun `opening starts as the card's colour and ends clear`() {
        assertEquals(1f, navCardTintAlpha(clock = 0f, closing = false), 0.001f)
        assertEquals(0f, navCardTintAlpha(clock = 1f, closing = false), 0.001f)
    }

    @Test
    fun `closing starts clear and ends as the card's colour`() {
        // Closing runs the clock from 1 (full screen) back to 0 (card).
        assertEquals(0f, navCardTintAlpha(clock = 1f, closing = true), 0.001f)
        assertEquals(1f, navCardTintAlpha(clock = 0f, closing = true), 0.001f)
    }

    // The point of the 4th power: while the panel is still large, it is still white. The curve is
    // front-loaded, so "large" is the first moments of a close and everything past the first
    // moments of an open.
    @Test
    fun `the tint stays off the large panel`() {
        assertTrue(navCardTintAlpha(clock = 0.5f, closing = false) < 0.05f)
        assertTrue(navCardTintAlpha(clock = 0.9f, closing = true) < 0.1f)
    }
}
