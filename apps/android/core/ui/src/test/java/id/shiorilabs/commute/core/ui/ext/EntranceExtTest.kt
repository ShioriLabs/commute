package id.shiorilabs.commute.core.ui.ext

import org.junit.Assert.assertEquals
import org.junit.Test

/** The same delays as the web's `staggerDelay(index, LIST_STAGGER)`. */
class EntranceExtTest {

    @Test
    fun `rows start 30 ms apart`() {
        assertEquals(0, rowStaggerDelayMillis(0))
        assertEquals(30, rowStaggerDelayMillis(1))
        assertEquals(360, rowStaggerDelayMillis(12))
    }

    @Test
    fun `rows past the cap share its delay`() {
        assertEquals(360, rowStaggerDelayMillis(13))
        assertEquals(360, rowStaggerDelayMillis(50))
    }

    @Test
    fun `a negative index waits nothing`() {
        assertEquals(0, rowStaggerDelayMillis(-1))
    }
}

/** The same delays as the web's `staggerDelay(index, CARD_STAGGER)`. */
class CardEntranceTest {

    @Test
    fun `cards start 45 ms apart, capped at the sixth`() {
        assertEquals(0, cardStaggerDelayMillis(0))
        assertEquals(45, cardStaggerDelayMillis(1))
        assertEquals(270, cardStaggerDelayMillis(6))
        assertEquals(270, cardStaggerDelayMillis(9))
    }
}
