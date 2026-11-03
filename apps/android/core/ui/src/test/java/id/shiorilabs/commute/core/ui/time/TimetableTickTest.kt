package id.shiorilabs.commute.core.ui.time

import org.junit.Assert.assertEquals
import org.junit.Test
import java.time.LocalDateTime

class TimetableTickTest {

    private fun at(m: Int, s: Int, nanos: Int = 0) = LocalDateTime.of(2026, 11, 3, 8, m, s, nanos)

    @Test
    fun `from the top of the minute, the next tick is a second on`() {
        assertEquals(at(0, 1), nextTimetableTick(at(0, 0)))
    }

    @Test
    fun `from a second on, the next is the half minute's`() {
        assertEquals(at(0, 31), nextTimetableTick(at(0, 1)))
        assertEquals(at(0, 31), nextTimetableTick(at(0, 30, 999_999_999)))
    }

    @Test
    fun `past the half minute's, the next is the minute turning`() {
        assertEquals(at(1, 0), nextTimetableTick(at(0, 31)))
        assertEquals(at(1, 0), nextTimetableTick(at(0, 59, 999_999_999)))
    }

    @Test
    fun `the last minute of the day ticks over into the next`() {
        val lastMinute = LocalDateTime.of(2026, 11, 3, 23, 59, 45)
        assertEquals(LocalDateTime.of(2026, 11, 4, 0, 0), nextTimetableTick(lastMinute))
    }
}
