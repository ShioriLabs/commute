package id.shiorilabs.commute.feature.journey.domain

import id.shiorilabs.commute.core.time.formatClock
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.time.Instant

class JourneyFormatTest {

    @Test
    fun `rupiah has no space and groups with dots`() {
        assertEquals("Rp6.500", formatRupiah(6500))
        assertEquals("Rp17.500", formatRupiah(17500))
        assertEquals("Rp0", formatRupiah(0))
    }

    @Test
    fun `kilometres keep one decimal at most, with a comma`() {
        assertEquals("13,5 km", formatKm(13_460))
        assertEquals("3 km", formatKm(3_000))
        assertEquals("0,6 km", formatKm(640))
    }

    @Test
    fun `clocks read on Jakarta's time with a dot`() {
        assertEquals("07.14", formatClock(Instant.parse("2026-10-05T00:14:00Z")))
    }

    @Test
    fun `durations stay in minutes up to two hours, then split hours out`() {
        val from = Instant.parse("2026-10-05T01:00:00Z")

        assertEquals("45 mnt", formatDuration(from, from.plusSeconds(45 * 60)))
        assertEquals("65 mnt", formatDuration(from, from.plusSeconds(65 * 60)))
        assertEquals("107 mnt", formatDuration(from, Instant.parse("2026-10-05T02:46:50Z")))
        assertEquals("120 mnt", formatDuration(from, from.plusSeconds(120 * 60)))
        assertEquals("2 j 1 mnt", formatDuration(from, from.plusSeconds(121 * 60)))
        assertEquals("", formatDuration(from, from.minusSeconds(60)))
    }

    @Test
    fun `an estimate is marked approximate, in the same shape as a duration`() {
        assertEquals("±45 mnt", formatEstimate(45 * 60))
        assertEquals("±65 mnt", formatEstimate(65 * 60))
        assertEquals("±2 j 8 mnt", formatEstimate(128 * 60))
    }

    @Test
    fun `an estimate rounds to the minute and never claims zero`() {
        assertEquals("±45 mnt", formatEstimate(44 * 60 + 31))
        assertEquals("±1 mnt", formatEstimate(20))
    }

    @Test
    fun `an estimated journey prints its estimate with the mark`() {
        assertEquals("±45 mnt", estimatedDurationOf(journey().copy(estimate = JourneyEstimate(2700, 0, listOf(1800)))))
    }

    @Test
    fun `an estimate counts from the first boarding when a timed ride opens the journey`() {
        assertEquals("±42 mnt", estimatedDurationOf(journey().copy(estimate = JourneyEstimate(3000, 480, listOf(null, 1200)))))
    }

    @Test
    fun `no estimate, or an impossible one, says nothing`() {
        assertNull(estimatedDurationOf(journey()))
        assertNull(estimatedDurationOf(journey().copy(estimate = JourneyEstimate(300, 300, emptyList()))))
    }
}
