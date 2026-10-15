package id.shiorilabs.commute.wear

import id.shiorilabs.commute.core.time.JAKARTA
import id.shiorilabs.commute.core.time.ServiceDayName
import id.shiorilabs.commute.core.wearable.WearDay
import id.shiorilabs.commute.core.wearable.WearDirection
import id.shiorilabs.commute.core.wearable.WearStation
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Duration
import java.time.Instant
import java.time.LocalDateTime

class DepartureFramesTest {

    /** Friday 16 October 2026: 10.00, 10.10, 10.20, then nothing until 15.00. */
    private val direction = WearDirection(
        key = "KCI:B|S",
        lineKey = "KCI:B",
        lineName = "Lin Bogor",
        color = 0,
        label = "Depok · Bogor",
        days = mapOf(ServiceDayName.WD to WearDay(start = 264, minutes = listOf(264, 600, 610, 620, 900))),
    )

    @Test
    fun `frames follow on from now, each until its next train leaves`() {
        val frames = direction.departureFrames(wib(9, 55))
        assertEquals(wib(9, 55), frames.first().from)
        frames.zipWithNext().forEach { (a, b) -> assertEquals(a.until, b.from) }
        assertEquals(listOf(wib(10, 0), wib(10, 10), wib(10, 20)), frames.first().next)
        assertEquals(frames.first().next.first(), frames.first().until)
    }

    @Test
    fun `a train an hour or more off shows its time, then counts down for its last hour`() {
        val frames = direction.departureFrames(wib(10, 25))
        assertEquals(2, frames.takeWhile { it.until <= wib(15, 0) }.size)
        val (clock, countdown) = frames
        assertFalse(clock.countdown)
        assertEquals(wib(14, 0), clock.until)
        assertTrue(countdown.countdown)
        assertEquals(wib(14, 0), countdown.from)
        assertEquals(wib(15, 0), countdown.until)
    }

    @Test
    fun `only the next few hours are laid out`() {
        val frames = direction.departureFrames(wib(9, 55), horizon = Duration.ofMinutes(20))
        assertEquals(listOf(wib(10, 0), wib(10, 10), wib(10, 20)), frames.map { it.until })
    }

    @Test
    fun `a direction with nothing to come has no frames`() {
        val none = direction.copy(days = emptyMap())
        assertTrue(none.departureFrames(wib(9, 55)).isEmpty())
    }

    @Test
    fun `a station's copy grows old after two weeks`() {
        val built = wib(9, 0)
        val station = WearStation("KCI-TEB", "Tebet", built.toEpochMilli(), listOf(direction))
        assertFalse(station.isStale(built.plus(Duration.ofDays(13))))
        assertTrue(station.isStale(built.plus(Duration.ofDays(15))))
    }

    @Test
    fun `a direction goes by its last station in a small slot`() {
        assertEquals("Bogor", shortLabel("Depok · Bogor"))
        assertEquals("Jakarta Kota", shortLabel("Jakarta Kota"))
    }

    private fun wib(hour: Int, minute: Int): Instant = LocalDateTime.of(2026, 10, 16, hour, minute).atZone(JAKARTA).toInstant()
}
