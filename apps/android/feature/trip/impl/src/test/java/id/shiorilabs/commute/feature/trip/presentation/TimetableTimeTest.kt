package id.shiorilabs.commute.feature.trip.presentation

import org.junit.Assert.assertEquals
import org.junit.Test
import java.time.Instant

class TimetableTimeTest {

    private fun at(clock: String): Instant = Instant.parse("2026-10-05T${clock}Z")

    @Test
    fun `minutes off are counted as the clocks read, not by the second`() {
        // 09.50 on the timetable, the train at 09.54 and 40 s: it reads 09.54, so +4, not +5.
        assertEquals(4, minutesOff(at("02:50:00"), at("02:54:40")))
        assertEquals(0, minutesOff(at("02:50:00"), at("02:50:59")))
        assertEquals(-1, minutesOff(at("02:50:00"), at("02:49:30")))
    }
}
