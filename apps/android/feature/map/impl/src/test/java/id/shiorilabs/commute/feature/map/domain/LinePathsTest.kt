package id.shiorilabs.commute.feature.map.domain

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * The web's `map-line-path.test.ts`. The fixtures are written as the tracer emits them: contiguous
 * edges and an ordered station list, nothing saying where along the stroke each station sits.
 */
class LinePathsTest {

    /** A point whose centroid is exactly ([x], [y]). */
    private fun pt(id: String, x: Double, y: Double, station: String? = null) =
        MapPoint(id = id, station = station, ax = x - 10, ay = y, bx = x + 10, by = y, r = 5.0)

    private fun edges(vararg pts: Pair<Double, Double>): List<List<Double>> =
        (1 until pts.size).map { listOf(pts[it - 1].first, pts[it - 1].second, pts[it].first, pts[it].second) }

    private fun line(key: String, vararg segments: MapLineSegment) =
        MapLine(key, key.substringBefore(':'), key.substringAfter(':'), key, "#FF0000", 5.0, segments.toList())

    private fun List<WorldPoint>?.xy() = this?.map { it.x to it.y }

    private val trunk = line(
        "KCI:C",
        MapLineSegment("TRUNK", edges(0.0 to 0.0, 100.0 to 0.0, 200.0 to 0.0, 300.0 to 0.0), listOf("A", "B", "C", "D")),
    )
    private val trunkPoints = listOf(pt("A", 0.0, 0.0), pt("B", 100.0, 0.0), pt("C", 200.0, 0.0), pt("D", 300.0, 0.0))

    private fun slice(lines: List<MapLine>, points: List<MapPoint>, key: String, from: String, to: String) =
        sliceLinePath(prepareLinePaths(lines, points), key, from, to).xy()

    @Test
    fun `it slices the traced stroke between two adjacent stops`() {
        assertEquals(listOf(100.0 to 0.0, 200.0 to 0.0), slice(listOf(trunk), trunkPoints, "KCI:C", "B", "C"))
    }

    @Test
    fun `it keeps the stroke's shape between stops that aren't adjacent`() {
        assertEquals(
            listOf(0.0 to 0.0, 100.0 to 0.0, 200.0 to 0.0, 300.0 to 0.0),
            slice(listOf(trunk), trunkPoints, "KCI:C", "A", "D"),
        )
    }

    @Test
    fun `a leg against the drawn direction comes back in travel order`() {
        assertEquals(listOf(200.0 to 0.0, 100.0 to 0.0, 0.0 to 0.0), slice(listOf(trunk), trunkPoints, "KCI:C", "C", "A"))
    }

    @Test
    fun `it follows a corner rather than chording across it`() {
        val cornered = line("KCI:C", MapLineSegment("TRUNK", edges(0.0 to 0.0, 100.0 to 0.0, 100.0 to 100.0), listOf("A", "B", "C")))
        val points = listOf(pt("A", 0.0, 0.0), pt("B", 100.0, 0.0), pt("C", 100.0, 100.0))
        assertEquals(listOf(0.0 to 0.0, 100.0 to 0.0, 100.0 to 100.0), slice(listOf(cornered), points, "KCI:C", "A", "C"))
    }

    @Test
    fun `there's no path for a line, a stop, or a pair the trace doesn't have`() {
        assertNull(slice(listOf(trunk), trunkPoints, "TJ:99", "B", "C"))
        assertNull(slice(listOf(trunk), trunkPoints, "KCI:C", "B", "Z"))
        // Both resolve to one spot on the stroke.
        assertNull(slice(listOf(trunk), trunkPoints, "KCI:C", "B", "B"))
    }

    @Test
    fun `a stop further off the stroke than the gate is refused, its neighbours still traced`() {
        val off = TRACED_PATH_MAX_OFFSET_WORLD + 10
        val points = listOf(pt("A", 0.0, 0.0), pt("B", 100.0, 0.0), pt("C", 200.0, off), pt("D", 300.0, 0.0))
        assertNull(slice(listOf(trunk), points, "KCI:C", "B", "C"))
        assertEquals(listOf(0.0 to 0.0, 100.0 to 0.0), slice(listOf(trunk), points, "KCI:C", "A", "B"))
    }

    @Test
    fun `a stop just inside the gate is sliced`() {
        val points = listOf(pt("A", 0.0, 0.0), pt("B", 100.0, 0.0), pt("C", 200.0, TRACED_PATH_MAX_OFFSET_WORLD - 1), pt("D", 300.0, 0.0))
        assertEquals(listOf(100.0 to 0.0, 200.0 to 0.0), slice(listOf(trunk), points, "KCI:C", "B", "C"))
    }

    @Test
    fun `a station drawn under an alias resolves to its own marker`() {
        val points = listOf(pt("A", 0.0, 0.0), pt("B-alias", 100.0, 0.0, "B"), pt("C", 200.0, 0.0), pt("D", 300.0, 0.0))
        assertEquals(listOf(100.0 to 0.0, 200.0 to 0.0), slice(listOf(trunk), points, "KCI:C", "B", "C"))
    }

    private val branched = line(
        "TJ:9",
        MapLineSegment("TRUNK", edges(0.0 to 0.0, 100.0 to 0.0, 200.0 to 0.0), listOf("A", "B", "J")),
        MapLineSegment("RAMP", edges(200.0 to 0.0, 200.0 to 100.0), listOf("J", "R")),
    )
    private val branchedPoints = listOf(pt("A", 0.0, 0.0), pt("B", 100.0, 0.0), pt("J", 200.0, 0.0), pt("R", 200.0, 100.0))

    @Test
    fun `a trunk pair rides the trunk and a branch pair the branch`() {
        assertEquals(listOf(100.0 to 0.0, 200.0 to 0.0), slice(listOf(branched), branchedPoints, "TJ:9", "B", "J"))
        assertEquals(listOf(200.0 to 0.0, 200.0 to 100.0), slice(listOf(branched), branchedPoints, "TJ:9", "J", "R"))
    }

    @Test
    fun `the run where the pair is adjacent wins`() {
        assertEquals(
            listOf(0.0 to 0.0, 100.0 to 0.0, 200.0 to 0.0),
            slice(listOf(branched), branchedPoints, "TJ:9", "A", "J"),
        )
    }

    private val broken = line(
        "TJ:4",
        // A 400-unit jump between the two pieces.
        MapLineSegment("TRUNK", edges(0.0 to 0.0, 100.0 to 0.0) + edges(500.0 to 0.0, 600.0 to 0.0), listOf("A", "B", "C", "D")),
    )
    private val brokenPoints = listOf(pt("A", 0.0, 0.0), pt("B", 100.0, 0.0), pt("C", 500.0, 0.0), pt("D", 600.0, 0.0))

    @Test
    fun `a stroke drawn in pieces still slices either side of its break, never across it`() {
        assertEquals(listOf(500.0 to 0.0, 600.0 to 0.0), slice(listOf(broken), brokenPoints, "TJ:4", "C", "D"))
        assertEquals(listOf(0.0 to 0.0, 100.0 to 0.0), slice(listOf(broken), brokenPoints, "TJ:4", "A", "B"))
        assertNull(slice(listOf(broken), brokenPoints, "TJ:4", "B", "C"))
    }

    @Test
    fun `a float-noise joint is continuous, not a break`() {
        val noisy = line("MRTJ:M", MapLineSegment("TRUNK", listOf(listOf(0.0, 0.0, 100.0, 0.0), listOf(100.029, 0.0, 200.0, 0.0)), listOf("A", "B", "C")))
        assertNotNull(slice(listOf(noisy), listOf(pt("A", 0.0, 0.0), pt("B", 100.0, 0.0), pt("C", 200.0, 0.0)), "MRTJ:M", "A", "C"))
    }

    private val loop = line(
        "TJ:2",
        MapLineSegment("LOOP", edges(0.0 to 0.0, 100.0 to 0.0, 100.0 to 100.0, 0.0 to 100.0, 0.0 to 0.0), listOf("A", "B", "C", "D", "A")),
    )
    private val loopPoints = listOf(pt("A", 0.0, 0.0), pt("B", 100.0, 0.0), pt("C", 100.0, 100.0), pt("D", 0.0, 100.0))

    @Test
    fun `a loop rides forward from its first stop and closes the short way`() {
        assertEquals(listOf(0.0 to 0.0, 100.0 to 0.0), slice(listOf(loop), loopPoints, "TJ:2", "A", "B"))
        assertEquals(listOf(0.0 to 100.0, 0.0 to 0.0), slice(listOf(loop), loopPoints, "TJ:2", "D", "A"))
    }

    @Test
    fun `resolving the wrap moves only the closing stop`() {
        assertEquals(listOf(100.0 to 0.0, 100.0 to 100.0), slice(listOf(loop), loopPoints, "TJ:2", "B", "C"))
        assertEquals(listOf(100.0 to 100.0, 0.0 to 100.0), slice(listOf(loop), loopPoints, "TJ:2", "C", "D"))
    }
}
