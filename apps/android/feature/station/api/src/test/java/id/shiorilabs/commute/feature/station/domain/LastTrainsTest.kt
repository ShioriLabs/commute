package id.shiorilabs.commute.feature.station.domain

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class LastTrainsTest {

    private fun hm(h: Int, m: Int) = h * 60 + m
    private fun dep(h: Int, m: Int) = Departure(null, hm(h, m))

    /** Half-hourly from 05:00 to 22:00: a day of service, so the overnight gap is the largest. */
    private val daytime = (5 * 60..22 * 60 step 30).map { Departure(null, it) }

    private fun destination(boundFor: String, departures: List<Departure>, via: String? = null) =
        DestinationTimetable(boundFor, via, departures)

    private fun line(key: String, vararg destinations: DestinationTimetable) =
        LineTimetable(key, listOf(DirectionGroup("g", listOf("Bogor"), null, destinations.toList())))

    @Test
    fun `the last three per destination, an after-midnight train last`() {
        val bogor = line("KCI:B", destination("Bogor", daytime + listOf(dep(23, 10), dep(23, 40), dep(0, 15))))

        val result = lastTrains(listOf(bogor))

        assertEquals(listOf(hm(23, 10), hm(23, 40), hm(0, 15)), result.single().destinations.single().minutes)
    }

    @Test
    fun `a short-turn gets a row of its own`() {
        val bogor = line(
            "KCI:B",
            destination("Bogor", daytime + dep(23, 0)),
            // Peak-only: its own midday gap is longer than the night, but the start is the line's.
            destination("Depok", listOf(dep(6, 0), dep(17, 0), dep(23, 30))),
        )

        val destinations = lastTrains(listOf(bogor)).single().destinations

        assertEquals(listOf("Bogor", "Depok"), destinations.map { it.boundFor })
        assertEquals(listOf(hm(6, 0), hm(17, 0), hm(23, 30)), destinations[1].minutes)
    }

    @Test
    fun `a line that never stops has no last train`() {
        // Every hour round the clock: no overnight gap to find a service start in.
        val roundTheClock = line("TJ:1", destination("Blok M", (0 until 24).map { dep(it, 0) }))

        assertTrue(lastTrains(listOf(roundTheClock)).isEmpty())
    }
}
