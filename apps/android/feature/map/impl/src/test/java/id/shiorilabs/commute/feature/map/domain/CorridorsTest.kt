package id.shiorilabs.commute.feature.map.domain

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.abs

/**
 * The web's `map-corridors.test.ts` and `map-corridor-colour.test.ts`: the matcher picks a leg's
 * corridor from geometry alone, so these stand between a curved route and a confidently wrong one.
 */
class CorridorsTest {

    private fun corridor(vararg pts: Pair<Double, Double>, w: Double = 25.0, c: String = "#00BDEE") =
        MapCorridor(w, c, pts.map { listOf(it.first, it.second) })

    private fun prep(vararg pts: Pair<Double, Double>) = corridor(*pts).prepared()

    private fun assertPointsClose(expected: List<Pair<Double, Double>>, actual: List<WorldPoint>?) {
        assertNotNull(actual)
        assertEquals(expected.size, actual!!.size)
        expected.zip(actual).forEach { (e, a) ->
            assertEquals(e.first, a.x, 1e-6)
            assertEquals(e.second, a.y, 1e-6)
        }
    }

    @Test
    fun `a point projects to its perpendicular foot, clamped to the segment`() {
        assertEquals(Projection(7.0, 50.0), projectOntoPolyline(50.0, 7.0, prep(0.0 to 0.0, 100.0 to 0.0)))
        // Unclamped, a stop past the end would match a corridor it never touches.
        assertEquals(Projection(40.0, 100.0), projectOntoPolyline(140.0, 0.0, prep(0.0 to 0.0, 100.0 to 0.0)))
    }

    @Test
    fun `arc length carries across vertices`() {
        val (dist, s) = projectOntoPolyline(103.0, 3.0, prep(0.0 to 0.0, 100.0 to 0.0, 100.0 to 100.0))
        assertEquals(3.0, dist, 1e-6)
        assertEquals(103.0, s, 1e-6)
    }

    @Test
    fun `a zero-length segment poisons nothing`() {
        val (dist, s) = projectOntoPolyline(10.0, 5.0, prep(0.0 to 0.0, 0.0 to 0.0, 50.0 to 0.0))
        assertTrue(dist.isFinite() && s.isFinite())
        assertEquals(5.0, dist, 1e-6)
    }

    private val lShape = prep(0.0 to 0.0, 100.0 to 0.0, 100.0 to 100.0)

    @Test
    fun `a sub-path interpolates both ends and keeps the vertices between`() {
        assertPointsClose(listOf(50.0 to 0.0, 100.0 to 0.0, 100.0 to 50.0), extractSubPolyline(lShape, 50.0, 150.0))
        assertPointsClose(listOf(20.0 to 0.0, 80.0 to 0.0), extractSubPolyline(lShape, 20.0, 80.0))
    }

    @Test
    fun `against the drawn direction it comes back in travel order`() {
        assertPointsClose(listOf(100.0 to 50.0, 100.0 to 0.0, 50.0 to 0.0), extractSubPolyline(lShape, 150.0, 50.0))
    }

    @Test
    fun `both feet on one spot give nothing`() {
        assertTrue(extractSubPolyline(lShape, 40.0, 40.0).isEmpty())
    }

    @Test
    fun `a polyline's length sums its segments`() {
        assertEquals(7.0, polylineLength(listOf(WorldPoint(0.0, 0.0), WorldPoint(3.0, 0.0), WorldPoint(3.0, 4.0))), 0.0)
    }

    @Test
    fun `it follows the corridor between two stops on it`() {
        val corridors = prepareCorridors(listOf(corridor(0.0 to 0.0, 100.0 to 0.0, 100.0 to 100.0)))
        assertPointsClose(listOf(0.0 to 0.0, 100.0 to 0.0, 100.0 to 100.0), matchCorridorPath(0.0, 0.0, 100.0, 100.0, corridors)?.path)
    }

    // The Jatinegara trap in miniature: the through line passes as near the junction as the branch
    // does, and only the partner stop says which is right.
    private val jatinegara = prepareCorridors(
        listOf(corridor(-1000.0 to 0.0, 1000.0 to 0.0), corridor(0.0 to 0.0, 0.0 to -500.0, 400.0 to -500.0)),
    )

    @Test
    fun `it takes the branch when the partner stop is down it`() {
        val path = matchCorridorPath(0.0, 1.0, 0.0, -498.0, jatinegara)?.path!!
        assertEquals(-498.0, path.last().y, 0.5)
        assertTrue(path.all { abs(it.x) < 1 })
    }

    @Test
    fun `it takes the through line when the partner stop is along it`() {
        val path = matchCorridorPath(0.0, 1.0, 600.0, 0.0, jatinegara)?.path!!
        assertEquals(600.0, path.last().x, 0.5)
        assertTrue(path.all { abs(it.y) < 1 })
    }

    private val loop = corridor(0.0 to 0.0, 0.0 to 400.0, 400.0 to 400.0, 400.0 to 0.0, 10.0 to 0.0)

    @Test
    fun `the long way round is refused for a chord`() {
        assertNull(matchCorridorPath(0.0, 0.0, 10.0, 0.0, prepareCorridors(listOf(loop))))
    }

    @Test
    fun `past a refused detour the runner-up is tried`() {
        val shortcut = corridor(0.0 to 1.0, 10.0 to 1.0, w = 15.0)
        val path = matchCorridorPath(0.0, 0.0, 10.0, 0.0, prepareCorridors(listOf(loop, shortcut)))?.path!!
        assertTrue(polylineLength(path) < 20)
    }

    @Test
    fun `a corridor near one stop but beyond the gate of the other is refused`() {
        val corridors = prepareCorridors(listOf(corridor(0.0 to 0.0, 1000.0 to 0.0)))
        assertNull(matchCorridorPath(100.0, 5.0, 200.0, CORRIDOR_MATCH_MAX_DIST_WORLD + 5, corridors))
        assertNotNull(matchCorridorPath(100.0, 0.0, 200.0, CORRIDOR_MATCH_MAX_DIST_WORLD - 5, corridors))
    }

    // A busway's two directions, drawn 22 apart.
    private val north = corridor(0.0 to 0.0, 1000.0 to 0.0, w = 15.0)
    private val south = corridor(0.0 to 22.0, 1000.0 to 22.0, w = 15.0)

    @Test
    fun `pair by pair it would hop between parallel strokes, the elected one holds it`() {
        val corridors = prepareCorridors(listOf(north, south))
        assertEquals(0, matchCorridorPath(100.0, 9.0, 200.0, 9.0, corridors)!!.index)
        assertEquals(1, matchCorridorPath(200.0, 13.0, 300.0, 13.0, corridors)!!.index)
        val held = matchCorridorPath(200.0, 13.0, 300.0, 13.0, corridors, preferIndex = 0)!!
        assertEquals(0, held.index)
        assertTrue(held.path.all { it.y == 0.0 })
    }

    @Test
    fun `a preferred corridor that no longer reaches the stops is given up`() {
        val branching = prepareCorridors(listOf(north, corridor(0.0 to 400.0, 1000.0 to 400.0, w = 15.0)))
        assertEquals(1, matchCorridorPath(100.0, 400.0, 300.0, 400.0, branching, preferIndex = 0)!!.index)
    }

    // Koridor 3 in miniature: its own stroke ends partway, a parallel one carries on, and the
    // middle stops lean a unit nearer the wrong one.
    private val koridor3 = prepareCorridors(listOf(corridor(0.0 to 12.0, 500.0 to 12.0, w = 15.0), corridor(300.0 to 0.0, 1000.0 to 0.0, w = 15.0)))
    private val koridor3Stops = listOf(
        WorldPoint(50.0, 12.0), WorldPoint(150.0, 12.0), WorldPoint(250.0, 12.0), WorldPoint(350.0, 5.0), WorldPoint(450.0, 5.0),
    )

    @Test
    fun `a leg elects the corridor serving most stops, whichever end it starts from`() {
        assertEquals(0, pickLegCorridor(koridor3Stops, koridor3))
        assertEquals(0, pickLegCorridor(koridor3Stops.reversed(), koridor3))
    }

    @Test
    fun `a tie in stops served goes to the nearer`() {
        assertEquals(1, pickLegCorridor(listOf(WorldPoint(400.0, 5.0), WorldPoint(480.0, 5.0)), koridor3))
    }

    @Test
    fun `a corridor reaching fewer than two stops is no leg's`() {
        assertNull(pickLegCorridor(listOf(WorldPoint(50.0, 12.0), WorldPoint(5000.0, 5000.0)), koridor3))
        assertNull(pickLegCorridor(emptyList(), koridor3))
    }

    @Test
    fun `the nearer of two parallel corridors wins`() {
        val corridors = prepareCorridors(listOf(corridor(0.0 to 30.0, 1000.0 to 30.0), corridor(0.0 to 0.0, 1000.0 to 0.0)))
        assertTrue(matchCorridorPath(100.0, 2.0, 300.0, 2.0, corridors)!!.path.all { it.y == 0.0 })
    }

    @Test
    fun `with no corridors, or stops on one spot, it chords`() {
        assertNull(matchCorridorPath(0.0, 0.0, 100.0, 0.0, emptyList()))
        assertNull(matchCorridorPath(50.0, 0.0, 50.0, 0.0, prepareCorridors(listOf(corridor(0.0 to 0.0, 100.0 to 0.0)))))
    }

    @Test
    fun `channel distance takes the worst channel, in either case`() {
        assertEquals(0, channelDistance("#ca2a51", "#ca2a51"))
        assertEquals(255, channelDistance("#000000", "#0000ff"))
        assertEquals(0, channelDistance("#CA2A51", "#ca2a51"))
    }

    @Test
    fun `a line matches its own stroke, never a yellow line a blue one`() {
        assertTrue(colourMatches("#CA2A51", "#ca2a51"))
        assertEquals(false, colourMatches("#2355A2", "#F8C434"))
    }

    @Test
    fun `a stroke coloured as a line sharing the track passes, no other`() {
        assertTrue(colourMatches("#036C3E", "#21409A", listOf("#006838")))
        assertEquals(false, colourMatches("#2355A2", "#F8C434", listOf("#EE3D43")))
    }

    @Test
    fun `an unknown colour either side is eligible`() {
        assertTrue(colourMatches(null, "#F8C434"))
        assertTrue(colourMatches("#CA2A51", null))
    }

    @Test
    fun `the shipped corridors carry both widths, a colour each, inside the map`() {
        val corridors = WebMapData.corridors.corridors
        assertTrue(corridors.size >= 32)
        assertTrue(corridors.count { it.w == 25.0 } >= 16)
        assertTrue(corridors.count { it.w == 15.0 } >= 38)
        for (corridor in corridors) {
            assertTrue(corridor.c.matches(Regex("^#[0-9A-F]{6}$")))
            assertTrue(corridor.pts.size >= 2)
            for ((x, y) in corridor.pts) assertTrue(x in 0.0..9514.0 && y in 0.0..6727.0)
            assertTrue(colourMatches(corridor.c, corridor.c))
        }
    }
}
