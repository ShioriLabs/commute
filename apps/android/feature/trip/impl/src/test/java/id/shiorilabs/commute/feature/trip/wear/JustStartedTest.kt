package id.shiorilabs.commute.feature.trip.wear

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant

class JustStartedTest {

    private val start = Instant.parse("2026-10-05T01:00:00Z")

    @Test
    fun `a trip started moments ago opens the watch`() {
        assertTrue(justStarted(start, openedFor = null, now = start.plusSeconds(5)))
    }

    @Test
    fun `a trip opens the watch once`() {
        assertFalse(justStarted(start, openedFor = start, now = start.plusSeconds(5)))
    }

    @Test
    fun `a trip picked back up mid-ride doesn't`() {
        assertFalse(justStarted(start, openedFor = null, now = start.plusSeconds(600)))
    }

    @Test
    fun `the next trip opens it again`() {
        val next = start.plusSeconds(3_600)
        assertTrue(justStarted(next, openedFor = start, now = next.plusSeconds(2)))
    }
}
