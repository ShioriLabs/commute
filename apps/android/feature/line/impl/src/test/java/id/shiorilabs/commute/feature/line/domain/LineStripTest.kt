package id.shiorilabs.commute.feature.line.domain

import id.shiorilabs.commute.feature.line.data.impl.toLineDetail
import id.shiorilabs.commute.feature.line.lineFixture
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class LineStripTest {

    private fun line(name: String) = lineFixture(name).toLineDetail()

    private val LineStrip.stops get() = rows.filterIsInstance<StripRow.Stop>()
    private val LineStrip.ramps get() = rows.filterIsInstance<StripRow.Ramp>()

    @Test
    fun `Bogor runs on to Bogor, with Nambo peeling off Citayam`() {
        val strip = lineStrip(line("line_bogor.json"))

        assertEquals(21 + 3, strip.stops.size)
        assertEquals("JAKK", strip.stops.first().station.code)
        assertEquals("BOO", strip.stops.last().station.code)
        val junction = strip.rows.indexOfFirst { it is StripRow.Stop && it.station.code == "CTA" }
        assertEquals(NodeKind.JUNCTION, (strip.rows[junction] as StripRow.Stop).kind)
        // The ramp sits right under its junction.
        assertEquals(StripRow.Ramp(tailIndex = 1, terminusName = "Nambo"), strip.rows[junction + 1])
        assertEquals(1, strip.ramps.size)
        assertNull(strip.loop)
    }

    @Test
    fun `showing Nambo swaps it inline, and Bogor becomes the ramp`() {
        val strip = lineStrip(line("line_bogor.json"), activeTail = 1)

        assertEquals("NMO", strip.stops.last().station.code)
        assertEquals(listOf(StripRow.Ramp(tailIndex = 0, terminusName = "Bogor")), strip.ramps)
    }

    @Test
    fun `a branch index past the tails there are shows the last of them`() {
        val strip = lineStrip(line("line_bogor.json"), activeTail = 7)

        assertEquals("NMO", strip.stops.last().station.code)
    }

    @Test
    fun `the strip's ends are termini capping the rail, and the stops between are passing ones`() {
        val stops = lineStrip(line("line_tangerang.json")).stops

        assertEquals(StripRow.Stop(stops.first().station, NodeKind.TERMINUS, RailCap.START), stops.first())
        assertEquals(StripRow.Stop(stops.last().station, NodeKind.TERMINUS, RailCap.END), stops.last())
        val middle = stops.drop(1).dropLast(1)
        assertTrue(middle.all { it.railCap == null })
        assertTrue(middle.all { it.kind == if (it.station.isInterchange) NodeKind.INTERCHANGE else NodeKind.REGULAR })
    }

    @Test
    fun `a single tail just carries on, and ramps joining mid-trunk are left out`() {
        val strip = lineStrip(line("line_tj_1.json"))

        assertEquals(22 + 2, strip.stops.size)
        assertTrue(strip.ramps.isEmpty())
        assertTrue(strip.stops.none { it.kind == NodeKind.JUNCTION })
        assertEquals(NodeKind.TERMINUS, strip.stops.last().kind)
    }

    @Test
    fun `Cikarang is a lollipop, its trunk ending at the junction its loop hangs off`() {
        val strip = lineStrip(line("line_cikarang.json"))

        assertEquals(12, strip.stops.size)
        assertEquals(StripRow.Stop(strip.stops.last().station, NodeKind.JUNCTION, RailCap.END), strip.stops.last())
        assertEquals("JNG", strip.stops.last().station.code)

        val loop = checkNotNull(strip.loop)
        // 14 stations: seven down the left, seven back up the right.
        assertEquals(7, loop.rows.size)
        assertEquals("POK" to "MTR", loop.rows.first().left.code to loop.rows.first().right?.code)
        val loopStations = line("line_cikarang.json").segments.single { it.kind == SegmentKind.LOOP }.stations
        // Round the bottom: the last on the left sits beside the first on the right.
        assertEquals(loopStations[6] to loopStations[7], loop.rows.last().left to loop.rows.last().right)
    }

    @Test
    fun `an odd loop leaves its top right empty, as plain rail into the closure`() {
        val (a, b, c) = listOf("A", "B", "C").map { LineStop("KCI-$it", it, it, "C1", false, emptyList()) }

        val loop = foldLoop(listOf(a, b, c))

        assertEquals(listOf(LoopRow(a, null), LoopRow(b, c)), loop.rows)
    }

    @Test
    fun `a line without a trunk draws nothing, and kinds the app doesn't know are left out`() {
        val tangerang = line("line_tangerang.json")
        val noTrunk = tangerang.copy(segments = tangerang.segments.map { it.copy(kind = SegmentKind.UNKNOWN) })

        assertTrue(lineStrip(noTrunk).rows.isEmpty())

        val withUnknown = lineFixture("line_tangerang.json").let { dto ->
            dto.copy(segments = dto.segments + dto.segments.first().copy(kind = "SPUR"))
        }.toLineDetail()
        assertEquals(SegmentKind.UNKNOWN, withUnknown.segments.last().kind)
        assertEquals(lineStrip(tangerang), lineStrip(withUnknown))
    }
}
