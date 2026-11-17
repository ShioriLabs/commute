package id.shiorilabs.commute.feature.map.domain

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ApproximateSpotTest {

    private fun dot(id: String, x: Double, y: Double, station: String? = null) =
        MapPoint(id = id, ax = x, ay = y, bx = x, by = y, r = 10.0, station = station)

    private val points = listOf(
        dot("KCI-A", 0.0, 0.0),
        dot("KCI-B", 100.0, 0.0),
        dot("HUB-AB", 50.0, 0.0),
        dot("TJ-C1", 0.0, 100.0, station = "TJ-C"),
        dot("TJ-C2", 0.0, 300.0, station = "TJ-C"),
    )

    @Test
    fun `at one station, its marker`() {
        val spot = approximateSpot(points, listOf("KCI-A" to 0))!!
        assertEquals(0.0, spot.first, 1e-9)
        assertEquals(0.0, spot.second, 1e-9)
    }

    @Test
    fun `between two, nearer the nearer one`() {
        val spot = approximateSpot(points, listOf("KCI-A" to 100, "KCI-B" to 300))!!
        assertEquals(0.0, spot.second, 1e-9)
        assert(spot.first > 0.0 && spot.first < 50.0) { "expected nearer A, was ${spot.first}" }
    }

    @Test
    fun `equally far, halfway`() {
        val spot = approximateSpot(points, listOf("KCI-A" to 400, "KCI-B" to 400))!!
        assertEquals(50.0, spot.first, 1e-9)
    }

    @Test
    fun `a station drawn twice counts once, at its first marker, and one off the map is left out`() {
        val spot = approximateSpot(points, listOf("TJ-C" to 0, "KCI-ZZZ" to 0))!!
        assertEquals(0.0, spot.first, 1e-9)
        assertEquals(100.0, spot.second, 1e-9)
    }

    @Test
    fun `nothing near, or nothing on the map, is no spot`() {
        assertNull(approximateSpot(points, emptyList()))
        assertNull(approximateSpot(points, listOf("KCI-ZZZ" to 10)))
    }
}
