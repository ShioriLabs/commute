package id.shiorilabs.commute.core.ui.morph

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class NavCardTintTest {

    private val screen = 1080f
    private val card = 462f

    @Test
    fun `the card is its colour`() {
        assertEquals(1f, navCardTintAlpha(panelWidth = card, screenWidth = screen, cardWidth = card), 0.001f)
    }

    // The point of the 4th power: while the panel is still large, it is still white.
    @Test
    fun `the tint stays off the large panel`() {
        val halfway = (screen + card) / 2
        assertTrue(navCardTintAlpha(panelWidth = halfway, screenWidth = screen, cardWidth = card) < 0.1f)
    }

    // The tester's flash: on a slow phone the shrink starts frames after the transition does, so
    // the screen still fills the display while the morph's clock is well on. The tint goes by the
    // panel, not the clock, so it stays clear.
    @Test
    fun `a panel that hasn't started shrinking stays clear`() {
        assertEquals(0f, navCardTintAlpha(panelWidth = screen, screenWidth = screen, cardWidth = card), 0f)
    }

    @Test
    fun `an overshoot past the card stays the card's colour`() {
        assertEquals(1f, navCardTintAlpha(panelWidth = card - 10f, screenWidth = screen, cardWidth = card), 0f)
    }

    @Test
    fun `a card it can't measure against isn't tinted`() {
        assertEquals(0f, navCardTintAlpha(panelWidth = card, screenWidth = screen, cardWidth = null), 0f)
        assertEquals(0f, navCardTintAlpha(panelWidth = card, screenWidth = card, cardWidth = card), 0f)
    }
}
