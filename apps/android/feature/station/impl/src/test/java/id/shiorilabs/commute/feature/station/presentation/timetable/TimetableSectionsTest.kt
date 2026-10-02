package id.shiorilabs.commute.feature.station.presentation.timetable

import id.shiorilabs.commute.feature.station.domain.Departure
import id.shiorilabs.commute.feature.station.domain.DestinationTimetable
import id.shiorilabs.commute.feature.station.domain.DirectionGroup
import id.shiorilabs.commute.feature.station.domain.LineTimetable
import org.junit.Assert.assertEquals
import org.junit.Test

class TimetableSectionsTest {

    private fun hm(h: Int, m: Int) = h * 60 + m
    private fun dep(h: Int, m: Int) = Departure(null, hm(h, m))

    /** Half-hourly from 05:00 to 22:00, then two late trains, one after midnight. */
    private val bogor = LineTimetable(
        lineKey = "KCI:B",
        groups = listOf(
            DirectionGroup(
                key = "south",
                label = listOf("Depok", "Bogor"),
                platformCode = "3",
                destinations = listOf(
                    DestinationTimetable("Bogor", null, (5 * 60..22 * 60 step 30).map { Departure(null, it) } + dep(0, 15)),
                    DestinationTimetable("Depok", null, listOf(dep(23, 40))),
                ),
            ),
        ),
    )

    private val section = timetableSections(listOf(bogor)).single()

    @Test
    fun `a section per line and direction, every departure in service order`() {
        assertEquals("KCI:B:south", section.key)
        assertEquals(hm(5, 0), section.rows.first().minute)
        // Tonight's late trains come last, the one after midnight very last.
        assertEquals(listOf(hm(22, 0), hm(23, 40), hm(0, 15)), section.rows.takeLast(3).map { it.minute })
        assertEquals("Depok", section.rows[section.rows.size - 2].boundFor)
    }

    @Test
    fun `the nearest departure counts one that left a minute ago`() {
        assertEquals(section.rows.indexOfFirst { it.minute == hm(8, 0) }, nearestIndex(section, hm(8, 1)))
        assertEquals(section.rows.indexOfFirst { it.minute == hm(8, 30) }, nearestIndex(section, hm(8, 2)))
    }

    @Test
    fun `late at night the after-midnight train is still to come`() {
        assertEquals(section.rows.lastIndex, nearestIndex(section, hm(23, 50)))
    }

    @Test
    fun `once the service is over there is no next departure`() {
        assertEquals(-1, nearestIndex(section, hm(1, 30)))
    }

    @Test
    fun `before the first train of the day it is the first row`() {
        assertEquals(0, nearestIndex(section, hm(4, 10)))
    }
}
