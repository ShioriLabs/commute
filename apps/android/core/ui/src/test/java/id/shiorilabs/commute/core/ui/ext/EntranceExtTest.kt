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
