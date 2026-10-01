package id.shiorilabs.commute.core.time

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDateTime

/** Ported from the web's `utils/service-day.test.ts`. */
class ServiceDayTest {

    private fun hm(h: Int, m: Int) = h * 60 + m
    private fun at(iso: String) = LocalDateTime.parse(iso)

    // A Bogor-line-shaped night: runs 03:50 until 01:07 the next morning.
    private val overnight = List(60) { hm(3, 50) + it * 20 } + listOf(hm(23, 52), hm(0, 0), hm(0, 34), hm(1, 7))

    @Test
    fun `keeps the night on the day it started`() {
        // 00:30 Saturday is still Friday night's service.
        assertEquals(ServiceDayName.WD, serviceDayOf(at("2026-10-03T00:30:00")))
        assertEquals(ServiceDayName.SAT, serviceDayOf(at("2026-10-03T03:00:00")))
        assertEquals(ServiceDayName.SAT, serviceDayOf(at("2026-10-04T01:00:00")))
        assertEquals(ServiceDayName.SUN, serviceDayOf(at("2026-10-05T01:00:00")))
    }

    @Test
    fun `runs holidays as Sunday`() {
        // 2026-05-01, Hari Buruh, is a Friday.
        assertEquals(ServiceDayName.SUN, serviceDayOf(at("2026-05-01T12:00:00")))
        // The small hours after it are still the holiday's service.
        assertEquals(ServiceDayName.SUN, serviceDayOf(at("2026-05-02T00:30:00")))
    }

    @Test
    fun `starts the day after the overnight gap, not at midnight`() {
        assertEquals(hm(3, 50), serviceStartMinute(overnight))
    }

    @Test
    fun `reports no start for a line that never stops`() {
        assertNull(serviceStartMinute(List(48) { it * 30 }))
    }

    @Test
    fun `orders past midnight as later, like the platform does`() {
        val start = serviceStartMinute(overnight)!!
        assertEquals(listOf(hm(0, 0), hm(0, 34), hm(1, 7)), lastDepartures(overnight, start) { it })
    }

    @Test
    fun `is running up to and including the last departure`() {
        assertFalse(isServiceOver(hm(23, 30), hm(0, 47), hm(3, 50)))
        assertFalse(isServiceOver(hm(0, 47), hm(0, 47), hm(3, 50)))
    }

    @Test
    fun `is over through the whole dead zone`() {
        assertTrue(isServiceOver(hm(0, 48), hm(0, 47), hm(3, 50)))
        assertTrue(isServiceOver(hm(3, 30), hm(0, 47), hm(3, 50)))
    }

    @Test
    fun `is running again once the day starts`() {
        assertFalse(isServiceOver(hm(3, 50), hm(0, 47), hm(3, 50)))
    }

    @Test
    fun `positions minutes relative to the start`() {
        assertTrue(servicePosition(hm(0, 0), hm(3, 50)) > servicePosition(hm(23, 0), hm(3, 50)))
    }

    @Test
    fun `names the next service day, holidays included`() {
        // Friday night, before and after midnight: tomorrow is Saturday either way.
        assertEquals(ServiceDayName.SAT, nextServiceDayOf(at("2026-10-02T23:30:00")))
        assertEquals(ServiceDayName.SAT, nextServiceDayOf(at("2026-10-03T01:30:00")))
        // Thursday 30 April 2026: the Friday after is Hari Buruh.
        assertEquals(ServiceDayName.SUN, nextServiceDayOf(at("2026-04-30T22:00:00")))
    }

    @Test
    fun `finds the first departure after the overnight gap, not at midnight`() {
        val start = serviceStartMinute(overnight)!!
        assertEquals(hm(3, 50), firstDeparture(overnight, start) { it })
    }

    @Test
    fun `restarts today only between the rollover and the first departure`() {
        assertTrue(restartsToday(hm(4, 10), hm(4, 24)))
        assertFalse(restartsToday(hm(1, 30), hm(4, 24)))
        assertFalse(restartsToday(hm(23, 30), hm(4, 24)))
    }
}
