package id.shiorilabs.commute.feature.station.domain

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDateTime

class DepartureBoardTest {

    private fun hm(h: Int, m: Int) = h * 60 + m
    private fun at(h: Int, m: Int, s: Int = 0) = LocalDateTime.of(2026, 10, 1, h, m, s)
    private fun dep(h: Int, m: Int) = Departure(null, hm(h, m))

    // --- Labels, ported from utils/schedules.test.ts -------------------------------------------

    private val eight = at(8, 0)

    @Test
    fun `a just-departed train and one within a minute read Sekarang`() {
        assertEquals(DepartureLabel.Now, departureLabel(eight, hm(7, 59)))
        assertEquals(DepartureLabel.Now, departureLabel(eight, hm(8, 0)))
        assertEquals(DepartureLabel.Now, departureLabel(eight, hm(8, 1)))
    }

    @Test
    fun `departures inside the window read in minutes, the 15-30 band included`() {
        assertEquals(DepartureLabel.InMinutes(2), departureLabel(eight, hm(8, 2)))
        assertEquals(DepartureLabel.InMinutes(15), departureLabel(eight, hm(8, 15)))
        assertEquals(DepartureLabel.InMinutes(29), departureLabel(eight, hm(8, 29)))
    }

    @Test
    fun `at and beyond the window, and well in the past, it is a clock time`() {
        assertEquals(DepartureLabel.At(hm(8, 30)), departureLabel(eight, hm(8, 30)))
        assertEquals(DepartureLabel.At(hm(8, 45)), departureLabel(eight, hm(8, 45)))
        assertEquals(DepartureLabel.At(hm(6, 0)), departureLabel(eight, hm(6, 0)))
    }

    @Test
    fun `imminent covers a train that just left through three minutes out`() {
        assertTrue(isImminentDeparture(eight, hm(7, 59)))
        assertTrue(isImminentDeparture(eight, hm(8, 0)))
        assertTrue(isImminentDeparture(eight, hm(8, 3)))
        assertFalse(isImminentDeparture(eight, hm(8, 4)))
        // The first-train fallback holds a time hours in the past; it must not pulse.
        assertFalse(isImminentDeparture(eight, hm(4, 0)))
    }

    @Test
    fun `formats like the signage`() {
        assertEquals("05.07", formatClock(hm(5, 7)))
        assertEquals("Bogor · Nambo", joinLabels(listOf("Bogor", "Nambo")))
        assertEquals("3·4", formatPlatformCode("3 / 4"))
    }

    // --- Next departures ---------------------------------------------------------------------------

    @Test
    fun `takes the next three, keeping one that left within the minute`() {
        val departures = listOf(dep(7, 50), dep(7, 59), dep(8, 5), dep(8, 10), dep(8, 20))

        assertEquals(listOf(dep(7, 59), dep(8, 5), dep(8, 10)), nextDepartures(departures, at(8, 0)))
    }

    @Test
    fun `late at night, after-midnight departures sort after the evening`() {
        val departures = listOf(dep(0, 10), dep(23, 50), dep(5, 0))

        assertEquals(listOf(dep(23, 50), dep(0, 10)), nextDepartures(departures, at(23, 40)))
    }

    @Test
    fun `falls back to the first departure when nothing is left`() {
        assertEquals(listOf(dep(5, 0)), nextDepartures(listOf(dep(5, 0), dep(6, 0)), at(22, 0)))
    }

    // --- Upcoming groups ---------------------------------------------------------------------------

    // Runs every 20 minutes from 04:00 to 23:40, then 00:10: a line whose night is obvious.
    private val bogorRun = List(60) { dep(4, 0).copy(minute = hm(4, 0) + it * 20) } + dep(0, 10)

    private fun board(departures: List<Departure>, key: String = "G1", label: List<String> = listOf("Bogor")) =
        LineTimetable(
            lineKey = "KCI:B",
            groups = listOf(
                DirectionGroup(
                    key = key,
                    label = label,
                    platformCode = null,
                    destinations = listOf(DestinationTimetable("Bogor", null, departures)),
                ),
            ),
        )

    @Test
    fun `a running line shows its next departures`() {
        val row = upcomingGroups(board(bogorRun), null, at(8, 5)).single().destinations.single()

        assertFalse(row.over)
        assertEquals(listOf(hm(8, 20), hm(8, 40), hm(9, 0)), row.departures.map { it.minute })
    }

    @Test
    fun `after the last train it says so, with the last one`() {
        val row = upcomingGroups(board(bogorRun), null, at(1, 30)).single().destinations.single()

        assertTrue(row.over)
        assertEquals(listOf(hm(0, 10)), row.departures.map { it.minute })
        // 01:30 is before the rollover, so the restart is on the next day's board, not given here.
        assertNull(row.restart)
    }

    @Test
    fun `after the rollover the restart is today's first train`() {
        val row = upcomingGroups(board(bogorRun), null, at(3, 30)).single().destinations.single()

        assertTrue(row.over)
        assertEquals(hm(4, 0), row.restart?.minute)
    }

    @Test
    fun `before the rollover the restart comes from the next day's board`() {
        val saturday = board(List(50) { dep(5, 0).copy(minute = hm(5, 0) + it * 20) })

        val row = upcomingGroups(board(bogorRun), saturday, at(1, 30)).single().destinations.single()

        assertEquals(hm(5, 0), row.restart?.minute)
    }

    @Test
    fun `a group signed only with its terminus drops its header`() {
        val group = upcomingGroups(board(bogorRun), null, at(8, 0)).single()

        assertTrue(group.labelIsRedundant)
        assertFalse(group.showHeader)
    }

    @Test
    fun `a direction with several termini keeps its header`() {
        val group = upcomingGroups(board(bogorRun, label = listOf("Bogor", "Nambo")), null, at(8, 0)).single()

        assertTrue(group.showHeader)
    }
}
