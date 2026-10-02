package id.shiorilabs.commute.feature.journey.domain

import org.junit.Assert.assertEquals
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
    fun `durations are minutes, then hours and minutes`() {
        val from = Instant.parse("2026-10-05T01:00:00Z")

        assertEquals("45 mnt", formatDuration(from, from.plusSeconds(45 * 60)))
        assertEquals("1 j 5 mnt", formatDuration(from, from.plusSeconds(65 * 60)))
        assertEquals("1 j 47 mnt", formatDuration(from, Instant.parse("2026-10-05T02:46:50Z")))
        assertEquals("", formatDuration(from, from.minusSeconds(60)))
    }
}
