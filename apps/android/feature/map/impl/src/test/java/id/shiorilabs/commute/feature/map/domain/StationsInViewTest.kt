package id.shiorilabs.commute.feature.map.domain

import org.junit.Assert.assertEquals
import org.junit.Test

class StationsInViewTest {

    private fun dot(id: String, x: Double, y: Double, station: String? = null) =
        MapPoint(id = id, ax = x, ay = y, bx = x, by = y, r = 10.0, station = station)

    // A 400 × 800 dp view on a 4000 × 4000 world at scale 1, panned so the world's (1000, 1000) is
    // its top left.
    private val view = Viewport(width = 400.0, height = 800.0, worldWidth = 4000.0, worldHeight = 4000.0)
    private val camera = Transform(tx = -1000.0, ty = -1000.0, scale = 1.0)

    @Test
    fun `only stations on screen, nearest the middle first`() {
        val points = listOf(
            dot("KCI-FAR", 1390.0, 1790.0),
            dot("KCI-MID", 1200.0, 1400.0),
            dot("KCI-OFF", 900.0, 1400.0),
            dot("KCI-NEAR", 1250.0, 1450.0),
        )
        assertEquals(listOf("KCI-MID", "KCI-NEAR", "KCI-FAR"), stationsInView(points, camera, view, limit = 6))
    }

    @Test
    fun `what the sheet covers doesn't count, and the middle is of what shows above it`() {
        val points = listOf(
            dot("KCI-UNDER", 1200.0, 1700.0),
            dot("KCI-TOP", 1200.0, 1050.0),
            dot("KCI-CENTRE", 1200.0, 1200.0),
        )
        val covered = view.copy(insetBottom = 400.0)
        assertEquals(listOf("KCI-CENTRE", "KCI-TOP"), stationsInView(points, camera, covered, limit = 6))
    }

    @Test
    fun `hubs and names aren't stations, a station drawn twice counts once, and the limit holds`() {
        val points = listOf(
            dot("HUB-DKA", 1200.0, 1400.0),
            dot("LBL-KCI-A", 1200.0, 1400.0, station = "KCI-A"),
            dot("TJ-1", 1200.0, 1410.0, station = "TJ-X"),
            dot("TJ-2", 1200.0, 1420.0, station = "TJ-X"),
            dot("KCI-B", 1200.0, 1430.0),
            dot("KCI-C", 1200.0, 1440.0),
        )
        assertEquals(listOf("TJ-X", "KCI-B"), stationsInView(points, camera, view, limit = 2))
    }
}
