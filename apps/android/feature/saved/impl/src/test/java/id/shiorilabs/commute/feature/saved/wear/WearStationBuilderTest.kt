package id.shiorilabs.commute.feature.saved.wear

import id.shiorilabs.commute.core.time.ServiceDayName
import id.shiorilabs.commute.core.wearable.WearDay
import id.shiorilabs.commute.feature.station.domain.Departure
import id.shiorilabs.commute.feature.station.domain.DestinationTimetable
import id.shiorilabs.commute.feature.station.domain.DirectionGroup
import id.shiorilabs.commute.feature.station.domain.LineInfo
import id.shiorilabs.commute.feature.station.domain.LineTimetable
import id.shiorilabs.commute.feature.station.domain.Station
import org.junit.Assert.assertEquals
import org.junit.Test
import java.time.Instant

class WearStationBuilderTest {

    private val tebet = Station("KCI-TEB", "Tebet", "KCI", "TEB", listOf("KCI:B"))
    private val lines = mapOf("KCI:B" to LineInfo("Lin Bogor", "B", "#EE3D43", "KCI"))
    private val at = Instant.parse("2026-10-16T00:00:00Z")

    private fun group(key: String, label: List<String>, platform: String?, vararg destinations: Pair<String, List<Int>>) =
        DirectionGroup(
            key = key,
            label = label,
            platformCode = platform,
            destinations = destinations.map { (to, minutes) -> DestinationTimetable(to, null, minutes.map { Departure(null, it) }) },
        )

    /** Every 40 minutes from 04.24 to 22.24, as a real board is dense through the day; Depok's last runs to 00.34. */
    private val toBogor = (264..1344 step 40).toList()
    private val southbound = group("S", listOf("Depok", "Bogor"), "1/2", "Bogor" to toBogor.reversed(), "Depok" to listOf(610, 34))
    private val southboundMinutes = (toBogor + listOf(610, 34)).distinct().sorted()
    private val northbound = group("N", listOf("Jakarta Kota"), "3/4", "Jakarta Kota" to listOf(300, 700))
    // A peak-only short-turn: its own first train is at 16.00, but the line's day starts at 04.24.
    private val shortTurn = group("P", listOf("Manggarai"), null, "Manggarai" to listOf(960, 990))

    @Test
    fun `each of the line's directions, named and coloured as the phone's board has them`() {
        val station = wearStation(tebet, mapOf(ServiceDayName.WD to listOf(LineTimetable("KCI:B", listOf(southbound, northbound)))), lines, at)
        assertEquals("KCI-TEB", station.id)
        assertEquals("Tebet", station.name)
        assertEquals(at.toEpochMilli(), station.builtAt)
        assertEquals(listOf("KCI:B|S", "KCI:B|N"), station.directions.map { it.key })
        val south = station.directions.first()
        assertEquals("Depok · Bogor", south.label)
        assertEquals("1/2", south.platform)
        assertEquals("Lin Bogor", south.lineName)
        assertEquals(0xFFEE3D43.toInt(), south.color)
    }

    @Test
    fun `a direction's destinations run as one list`() {
        val station = wearStation(tebet, mapOf(ServiceDayName.WD to listOf(LineTimetable("KCI:B", listOf(southbound)))), lines, at)
        assertEquals(southboundMinutes, station.directions.single().days.getValue(ServiceDayName.WD).minutes)
    }

    @Test
    fun `the service day starts where the whole line's does`() {
        val board = listOf(LineTimetable("KCI:B", listOf(southbound, shortTurn)))
        val station = wearStation(tebet, mapOf(ServiceDayName.WD to board), lines, at)
        assertEquals(listOf(264, 264), station.directions.map { it.days.getValue(ServiceDayName.WD).start })
    }

    @Test
    fun `each kind of day it runs, and none it doesn't`() {
        val boards = mapOf(
            ServiceDayName.WD to listOf(LineTimetable("KCI:B", listOf(southbound, shortTurn))),
            ServiceDayName.SAT to listOf(LineTimetable("KCI:B", listOf(southbound))),
            ServiceDayName.SUN to listOf(LineTimetable("KCI:B", listOf(southbound))),
        )
        val station = wearStation(tebet, boards, lines, at)
        val turn = station.directions.single { it.key == "KCI:B|P" }
        assertEquals(setOf(ServiceDayName.WD), turn.days.keys)
        assertEquals(WearDay(start = 264, minutes = southboundMinutes), station.directions.first().days[ServiceDayName.SUN])
    }

    @Test
    fun `a line the dictionary doesn't know goes by its code, in grey`() {
        val station = wearStation(tebet, mapOf(ServiceDayName.WD to listOf(LineTimetable("KCI:X", listOf(northbound)))), lines, at)
        assertEquals("X", station.directions.single().lineName)
        assertEquals(0xFF64748B.toInt(), station.directions.single().color)
    }
}
