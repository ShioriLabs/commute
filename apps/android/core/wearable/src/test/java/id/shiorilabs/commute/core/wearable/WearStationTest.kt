package id.shiorilabs.commute.core.wearable

import id.shiorilabs.commute.core.time.JAKARTA
import id.shiorilabs.commute.core.time.ServiceDayName
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant
import java.time.LocalDateTime

class WearStationTest {

    /** First train 04.24 every day; the weekday board runs on past midnight, to 00.34. */
    private val bogorBound = WearDirection(
        key = "KCI:B|G1",
        lineKey = "KCI:B",
        lineName = "Lin Bogor",
        color = 0xFFEE3D43.toInt(),
        label = "Bogor",
        platform = "1/2",
        days = mapOf(
            ServiceDayName.WD to WearDay(start = 264, minutes = listOf(264, 600, 610, 1380, 34)),
            ServiceDayName.SAT to WearDay(start = 264, minutes = listOf(300, 620)),
            ServiceDayName.SUN to WearDay(start = 264, minutes = listOf(360, 700)),
        ),
    )

    @Test
    fun `the next few trains of the day`() {
        assertEquals(
            listOf(wib(10, 16, 10, 0), wib(10, 16, 10, 10), wib(10, 16, 23, 0)),
            bogorBound.nextDepartures(wib(10, 16, 9, 58), 3),
        )
    }

    @Test
    fun `past midnight the night still runs on the day it started`() {
        // Saturday 00.20: Friday's board, whose last train is at 00.34, then Saturday's.
        assertEquals(
            listOf(wib(10, 17, 0, 34), wib(10, 17, 5, 0), wib(10, 17, 10, 20)),
            bogorBound.nextDepartures(wib(10, 17, 0, 20), 3),
        )
    }

    @Test
    fun `late in the evening the after-midnight train comes before the next morning`() {
        assertEquals(
            listOf(wib(10, 17, 0, 34), wib(10, 17, 5, 0)),
            bogorBound.nextDepartures(wib(10, 16, 23, 30), 2),
        )
    }

    @Test
    fun `after the last train, the next service day's first`() {
        assertEquals(
            listOf(wib(10, 17, 5, 0), wib(10, 17, 10, 20)),
            bogorBound.nextDepartures(wib(10, 17, 0, 40), 2),
        )
    }

    @Test
    fun `a holiday runs the Sunday board`() {
        // Thursday 19 March 2026 is a holiday.
        assertEquals(
            listOf(wib(3, 19, 6, 0), wib(3, 19, 11, 40)),
            bogorBound.nextDepartures(wib(3, 19, 5, 30), 2),
        )
    }

    @Test
    fun `a day the board doesn't run gives nothing for it`() {
        val weekdaysOnly = bogorBound.copy(days = mapOf(ServiceDayName.WD to bogorBound.days.getValue(ServiceDayName.WD)))
        assertEquals(emptyList<Instant>(), weekdaysOnly.nextDepartures(wib(10, 17, 12, 0), 2))
    }

    @Test
    fun `a station crosses and comes back whole`() {
        val station = WearStation(id = "KCI-TEB", name = "Tebet", builtAt = 1_760_000_000_000, directions = listOf(bogorBound))
        assertEquals(station, WearStation.decode(station.encode()))
    }

    @Test
    fun `a busy station fits a data item`() {
        val direction = bogorBound.copy(
            days = ServiceDayName.entries.associateWith { WearDay(start = 264, minutes = (264 until 1440 step 6).toList()) },
        )
        val station = WearStation("KCI-MRI", "Manggarai", 0, List(24) { direction.copy(key = "K$it", label = "Jakarta Kota · Bogor $it") })
        assertTrue(station.encode().size < 100_000)
    }

    private fun wib(month: Int, day: Int, hour: Int, minute: Int): Instant =
        LocalDateTime.of(2026, month, day, hour, minute).atZone(JAKARTA).toInstant()
}
