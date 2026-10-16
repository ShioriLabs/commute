package id.shiorilabs.commute.core.ui.morph

import id.shiorilabs.commute.core.ui.motion.IosSpringEasing
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class NavCardMorphLayersTest {

    private val screen = 1080f
    private val card = 462f

    /** The panel's progress [millis] into a morph on a phone that keeps up. */
    private fun progressAt(millis: Float, closing: Boolean): Float {
        val travelled = IosSpringEasing.transform(millis / NAV_CARD_MORPH_MILLIS)
        return if (closing) travelled else 1f - travelled
    }

    @Test
    fun `progress runs from the full screen to the card`() {
        assertEquals(0f, navCardMorphProgress(panelWidth = screen, screenWidth = screen, cardWidth = card)!!, 0f)
        assertEquals(1f, navCardMorphProgress(panelWidth = card, screenWidth = screen, cardWidth = card)!!, 0f)
        assertEquals(0.5f, navCardMorphProgress(panelWidth = (screen + card) / 2, screenWidth = screen, cardWidth = card)!!, 0.001f)
    }

    @Test
    fun `progress holds at the card through an overshoot`() {
        assertEquals(1f, navCardMorphProgress(panelWidth = card - 10f, screenWidth = screen, cardWidth = card)!!, 0f)
    }

    @Test
    fun `there's no progress without a card to measure against`() {
        assertNull(navCardMorphProgress(panelWidth = card, screenWidth = screen, cardWidth = null))
        assertNull(navCardMorphProgress(panelWidth = card, screenWidth = card, cardWidth = card))
    }

    // On a phone that keeps up, reading the clock off the panel gives the clock back.
    @Test
    fun `the panel's clock is the transition's when it keeps up`() {
        for (millis in listOf(0f, 25f, 100f, 200f)) {
            assertEquals(millis, navCardMorphMillis(progressAt(millis, closing = true), closing = true), 1f)
            assertEquals(millis, navCardMorphMillis(progressAt(millis, closing = false), closing = false), 1f)
        }
    }

    @Test
    fun `the card is its colour and the full screen is clear`() {
        assertEquals(1f, navCardTintAlpha(progress = 1f), 0f)
        assertEquals(0f, navCardTintAlpha(progress = 0f), 0f)
    }

    // The point of the 4th power: while the panel is still large, it is still white.
    @Test
    fun `the tint stays off the large panel`() {
        assertTrue(navCardTintAlpha(progress = 0.5f) < 0.1f)
    }

    // The tester's flash: on a slow phone the shrink starts frames after the transition does. A
    // screen that hasn't begun to shrink is neither masked nor tinted, however long that takes.
    @Test
    fun `a closing screen that hasn't started shrinking is left alone`() {
        assertEquals(0f, navCardMaskAlpha(progress = 0f, closing = true), 0.001f)
        assertEquals(0f, navCardTintAlpha(progress = 0f), 0f)
        assertEquals(1f, navCardLandingAlpha(progress = 0f, closing = true), 0f)
    }

    @Test
    fun `closing, the mask is up within the first frames`() {
        assertTrue(navCardMaskAlpha(progressAt(60f, closing = true), closing = true) > 0.8f)
    }

    @Test
    fun `opening, the mask holds over the card and clears as the screen fills`() {
        assertEquals(1f, navCardMaskAlpha(progress = 1f, closing = false), 0f)
        assertEquals(1f, navCardMaskAlpha(progressAt(40f, closing = false), closing = false), 0.001f)
        assertEquals(0f, navCardMaskAlpha(progressAt(160f, closing = false), closing = false), 0.001f)
    }

    @Test
    fun `the panel crossfades into the card only as it lands`() {
        assertEquals(1f, navCardLandingAlpha(progressAt(140f, closing = true), closing = true), 0.001f)
        assertEquals(0.5f, navCardLandingAlpha(progressAt(200f, closing = true), closing = true), 0.05f)
        assertEquals(0f, navCardLandingAlpha(progress = 1f, closing = true), 0.001f)
    }

    @Test
    fun `opening never fades the panel`() {
        assertEquals(1f, navCardLandingAlpha(progress = 1f, closing = false), 0f)
    }
}
