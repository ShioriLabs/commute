package id.shiorilabs.commute.feature.journey.domain

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Duration
import java.time.Instant
import java.time.LocalDate

class DepartureTimeTest {

    /** Monday 5 October 2026, 08.47 in Jakarta. */
    private val now = Instant.parse("2026-10-05T01:47:30Z")

    @Test
    fun `a time floors to the slot it falls in`() {
        assertEquals(Instant.parse("2026-10-05T01:40:00Z"), quantiseToSlot(now))
        assertEquals(Instant.parse("2026-10-05T01:40:00Z"), quantiseToSlot(Instant.parse("2026-10-05T01:40:00Z")))
    }

    @Test
    fun `nudging from now starts at the current slot`() {
        assertEquals(Instant.parse("2026-10-05T02:00:00Z"), shiftBySlot(Departure.Now, 1, now))
        assertEquals(
            Instant.parse("2026-10-05T01:00:00Z"),
            shiftBySlot(Departure.At(Instant.parse("2026-10-05T01:20:00Z")), -1, now),
        )
    }

    @Test
    fun `the picker offers a week, today first, on Jakarta's calendar`() {
        // 23.30 UTC on the 4th is already the 5th in Jakarta.
        val days = departureDays(Instant.parse("2026-10-04T23:30:00Z"))

        assertEquals(7, days.size)
        assertEquals(LocalDate.of(2026, 10, 5), days.first())
    }

    @Test
    fun `days and departures read as a rider names them`() {
        assertEquals("Hari ini", formatDepartureDay(LocalDate.of(2026, 10, 5), now))
        assertEquals("Besok", formatDepartureDay(LocalDate.of(2026, 10, 6), now))
        assertEquals("Rab, 7 Okt", formatDepartureDay(LocalDate.of(2026, 10, 7), now))

        assertEquals("Sekarang", formatDepartureLabel(Departure.Now, now))
        assertEquals("09.20", formatDepartureLabel(Departure.At(Instant.parse("2026-10-05T02:20:00Z")), now))
        assertEquals("Besok 06.00", formatDepartureLabel(Departure.At(Instant.parse("2026-10-05T23:00:00Z")), now))
    }

    @Test
    fun `a picked departure stays good until its slot ends`() {
        val current = Departure.At(Instant.parse("2026-10-05T01:40:00Z"))
        val previous = Departure.At(Instant.parse("2026-10-05T01:20:00Z"))

        assertFalse(isStaleDeparture(Departure.Now, now))
        assertFalse(isStaleDeparture(current, now))
        assertTrue(isStaleDeparture(previous, now))

        assertEquals(Duration.ofSeconds(750), untilDepartureStale(current, now))
        assertEquals(Duration.ofSeconds(1), untilDepartureStale(previous, now))
        assertNull(untilDepartureStale(Departure.Now, now))
    }
}
