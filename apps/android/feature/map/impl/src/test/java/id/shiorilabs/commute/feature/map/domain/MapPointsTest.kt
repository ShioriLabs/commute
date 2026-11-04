package id.shiorilabs.commute.feature.map.domain

import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/** Cases from the web's `map-renderer.test.ts` hit-test suite. */
class MapPointsTest {

    private fun dot(id: String, x: Double, y: Double, r: Double = 10.0, station: String? = null) =
        MapPoint(id = id, ax = x, ay = y, bx = x, by = y, r = r, station = station)

    private fun label(station: String, x: Double, y: Double) =
        MapPoint(id = "LBL-$station", ax = x - 60, ay = y, bx = x + 60, by = y, r = 20.0, cr = 6.0, station = station)

    @Test
    fun `a dot's distance is from its circle`() {
        val p = dot("KCI-MRI", 0.0, 0.0, r = 10.0)
        assertEquals(-10.0, p.signedDistance(0.0, 0.0), 1e-9)
        assertEquals(0.0, p.signedDistance(10.0, 0.0), 1e-9)
        assertEquals(5.0, p.signedDistance(0.0, 15.0), 1e-9)
    }

    @Test
    fun `a capsule runs along its segment and past each end by its radius`() {
        val p = MapPoint(id = "KCI-SUD", ax = 0.0, ay = 0.0, bx = 100.0, by = 0.0, r = 10.0)
        assertEquals(-10.0, p.signedDistance(50.0, 0.0), 1e-9)
        assertEquals(0.0, p.signedDistance(110.0, 0.0), 1e-9)
        assertEquals(0.0, p.signedDistance(50.0, 10.0), 1e-9)
    }

    @Test
    fun `a corner radius squares the capsule off`() {
        val round = MapPoint(id = "HUB-DKA", ax = 0.0, ay = 0.0, bx = 100.0, by = 0.0, r = 10.0)
        val square = round.copy(cr = 0.0)
        // The box's corner is inside the square shape, outside the round one.
        assertTrue(square.signedDistance(109.0, 9.0) < 0)
        assertTrue(round.signedDistance(109.0, 9.0) > 0)
    }

    @Test
    fun `a station's marker beats the hub region holding it`() {
        val hub = MapPoint(id = "HUB-DKA", ax = 0.0, ay = 0.0, bx = 200.0, by = 0.0, r = 60.0, cr = 10.0)
        val station = dot("KCI-SUDB", 50.0, 0.0)
        assertEquals(MapHit.Station(station), hitTest(50.0, 0.0, listOf(hub, station), emptyList(), 0.0))
        assertEquals(MapHit.Hub(hub), hitTest(150.0, 0.0, listOf(hub, station), emptyList(), 0.0))
    }

    @Test
    fun `a marker beats a name covering it, and a name catches the rest`() {
        val marker = dot("KCI-SUD", 0.0, 100.0)
        val other = dot("KCI-THB", 30.0, 0.0)
        val name = label("KCI-SUD", 0.0, 0.0)
        assertEquals(MapHit.Station(other), hitTest(30.0, 0.0, listOf(marker, other), listOf(name), 0.0))
        // Where only the name is, the tap opens the station it names, at its marker.
        assertEquals(MapHit.Station(marker), hitTest(-40.0, 0.0, listOf(marker, other), listOf(name), 0.0))
    }

    @Test
    fun `the slop widens every target`() {
        val p = dot("KCI-MRI", 0.0, 0.0, r = 10.0)
        assertNull(hitTest(15.0, 0.0, listOf(p), emptyList(), 0.0))
        assertEquals(MapHit.Station(p), hitTest(15.0, 0.0, listOf(p), emptyList(), 6.0))
    }

    @Test
    fun `a halte drawn twice opens one station, and its name the nearer marker`() {
        val near = dot("TJ-H00037C-b", 10.0, 0.0, station = "TJ-H00037C")
        val far = dot("TJ-H00037C", 500.0, 0.0)
        assertEquals("TJ-H00037C", near.stationId)
        assertSame(near, labelAnchor(label("TJ-H00037C", 0.0, 0.0), listOf(far, near)))
    }

    @Test
    fun `a name without a marker stands in for one`() {
        val lonely = label("KCI-XXX", 0.0, 0.0)
        assertSame(lonely, labelAnchor(lonely, listOf(dot("KCI-OTHER", 10.0, 10.0))))
    }

    @Test
    fun `every tap target the web ships opens a station the app can open`() {
        val json = Json { ignoreUnknownKeys = true }
        for (name in listOf("points.json", "label-points.json")) {
            val points = json.decodeFromString(MapPoints.serializer(), webData(name).readText())
            assertTrue("$name is usable for its edition", points.isUsableFor(points.version))
        }
    }

    @Test
    fun `tap targets for another edition, or naming nothing openable, aren't usable`() {
        val good = MapPoints("2026-08c", listOf(dot("KCI-MRI", 0.0, 0.0)))
        assertTrue(good.isUsableFor("2026-08c"))
        assertTrue(!good.isUsableFor("2026-09"))
        assertTrue(!MapPoints("2026-08c", emptyList()).isUsableFor("2026-08c"))
        assertTrue(!MapPoints("2026-08c", listOf(dot("manggarai", 0.0, 0.0))).isUsableFor("2026-08c"))
    }

    /** The web app's copy, in the same repo: what the app bundles. Tests run from the module's directory. */
    private fun webData(name: String): File = File("../../../../web/app/data/$name").also {
        assertTrue("${it.absolutePath} exists", it.exists())
    }
}
