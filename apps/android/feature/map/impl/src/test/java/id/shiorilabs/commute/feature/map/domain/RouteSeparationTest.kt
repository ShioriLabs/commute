package id.shiorilabs.commute.feature.map.domain

import id.shiorilabs.commute.core.geo.GeoPoint
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class RouteSeparationTest {

    private fun line(code: String, color: String, kind: String = "BRT") =
        BusMapLine(code = code, name = code, kind = kind, color = color, shapes = emptyList(), stops = emptyList())

    /** East along the equator-ish from [fromM] to [toM] metres, [northM] metres up. */
    private fun east(fromM: Double, toM: Double, northM: Double = 0.0): List<GeoPoint> {
        val lat = -6.2 + northM / 111_320.0
        val k = 111_320.0 * kotlin.math.cos(Math.toRadians(-6.2))
        return listOf(GeoPoint(lat, 106.8 + fromM / k), GeoPoint(lat, 106.8 + toM / k))
    }

    @Test
    fun `two lines on one lane sit side by side, the first listed on the left`() {
        val runs = separateRoutes(
            listOf(line("4", "#7E3794"), line("6", "#39B54A")),
            mapOf("4" to listOf(east(0.0, 500.0)), "6" to listOf(east(0.0, 500.0, northM = 0.8))),
        )
        assertEquals(listOf(-0.5), runs["4"]!!.map { it.slot })
        assertEquals(listOf(0.5), runs["6"]!!.map { it.slot })
    }

    @Test
    fun `a line alone keeps its middle, and steps aside only where another joins it`() {
        val runs = separateRoutes(
            listOf(line("4", "#7E3794"), line("6", "#39B54A")),
            mapOf("4" to listOf(east(0.0, 1000.0)), "6" to listOf(east(400.0, 1000.0))),
        )
        val four = runs["4"]!!
        assertEquals(listOf(0.0, -0.5), four.map { it.slot })
        assertEquals(400.0, (four[0].points.last().longitude - 106.8) * 111_320.0 * kotlin.math.cos(Math.toRadians(-6.2)), 10.0)
        assertEquals(listOf(0.5), runs["6"]!!.map { it.slot })
    }

    @Test
    fun `lines going opposite ways, or a lane apart, keep their middle`() {
        val runs = separateRoutes(
            listOf(line("4", "#7E3794"), line("6", "#39B54A"), line("9", "#C0C0C0")),
            mapOf(
                "4" to listOf(east(0.0, 500.0)),
                "6" to listOf(east(500.0, 0.0)),
                "9" to listOf(east(0.0, 500.0, northM = 6.0)),
            ),
        )
        for (code in listOf("4", "6", "9")) assertEquals(code, listOf(0.0), runs[code]!!.map { it.slot })
    }

    @Test
    fun `a colour's lines are one stroke`() {
        val runs = separateRoutes(
            listOf(line("13", "#9B59B6"), line("1", "#E74C3C"), line("13E", "#9B59B6")),
            mapOf("13" to listOf(east(0.0, 500.0)), "1" to listOf(east(0.0, 500.0)), "13E" to listOf(east(0.0, 500.0))),
        )
        assertEquals(runs["13"]!!.single().slot, runs["13E"]!!.single().slot, 0.0)
        assertEquals(-0.5, runs["13"]!!.single().slot, 0.0)
        assertEquals(0.5, runs["1"]!!.single().slot, 0.0)
    }

    @Test
    fun `a moment alongside doesn't step a line aside`() {
        val runs = separateRoutes(
            listOf(line("4", "#7E3794"), line("6", "#39B54A")),
            mapOf("4" to listOf(east(0.0, 1000.0)), "6" to listOf(east(500.0, 520.0))),
        )
        assertEquals(listOf(0.0), runs["4"]!!.map { it.slot })
    }

    @Test
    fun `rail lines and bus lines don't share a place`() {
        val runs = separateRoutes(
            listOf(line("4", "#7E3794"), line("KCI:C", "#0084D8", kind = "RAIL")),
            mapOf("4" to listOf(east(0.0, 500.0)), "KCI:C" to listOf(east(0.0, 500.0))),
        )
        assertEquals(listOf(0.0), runs["4"]!!.map { it.slot })
        assertEquals(listOf(0.0), runs["KCI:C"]!!.map { it.slot })
    }

    @Test
    fun `on the shipped map, 4 and 6 sit apart where they share a lane`() {
        val map = WebMapData.busMap
        val trunks = map.lines.filter { isTrunk(it.code) }
        val runs = separateRoutes(trunks, trunks.associate { it.code to it.drawnPieces })
        assertTrue(runs["4"]!!.any { it.slot != 0.0 })
        assertTrue(runs["6"]!!.any { it.slot != 0.0 })
    }
}
