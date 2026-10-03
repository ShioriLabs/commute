package id.shiorilabs.commute.core.ui.time

import org.junit.Assert.assertEquals
import org.junit.Test
import java.time.Duration
import java.time.Instant

class UpdatedAgoTest {

    private val now = Instant.parse("2026-10-03T10:00:00Z")

    private fun agoBy(duration: Duration) = updatedAgo(now - duration, now)

    @Test
    fun `under a minute is just now, a clock running behind included`() {
        assertEquals(UpdatedAgo.JustNow, agoBy(Duration.ofSeconds(59)))
        assertEquals(UpdatedAgo.JustNow, updatedAgo(now + Duration.ofSeconds(30), now))
    }

    @Test
    fun `each unit rounds down`() {
        assertEquals(UpdatedAgo.Minutes(1), agoBy(Duration.ofSeconds(119)))
        assertEquals(UpdatedAgo.Minutes(59), agoBy(Duration.ofMinutes(59).plusSeconds(59)))
        assertEquals(UpdatedAgo.Hours(1), agoBy(Duration.ofMinutes(60)))
        assertEquals(UpdatedAgo.Hours(23), agoBy(Duration.ofHours(23).plusMinutes(59)))
        assertEquals(UpdatedAgo.Days(1), agoBy(Duration.ofHours(24)))
        assertEquals(UpdatedAgo.Days(3), agoBy(Duration.ofDays(3).plusHours(20)))
    }
}
