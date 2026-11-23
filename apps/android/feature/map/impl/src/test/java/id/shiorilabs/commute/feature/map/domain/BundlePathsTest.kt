package id.shiorilabs.commute.feature.map.domain

import id.shiorilabs.commute.core.geo.GeoPoint
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.cos
import kotlin.math.hypot

class BundlePathsTest {

    private val lat0 = -6.2
    private val kx = 110_574.0 * cos(Math.toRadians(lat0))

    /** [x] metres east and [y] metres north of the origin. */
    private fun at(x: Double, y: Double) = GeoPoint(lat0 + y / 110_574.0, 106.8 + x / kx)

    private fun metres(p: GeoPoint) = (p.longitude - 106.8) * kx to (p.latitude - lat0) * 110_574.0

    private fun encode(vararg points: GeoPoint): String {
        val out = StringBuilder()
        var lastLat = 0L
        var lastLng = 0L
        fun put(v: Long) {
            var x = if (v < 0) (v shl 1).inv() else v shl 1
            while (x >= 0x20) {
                out.append(((0x20 or (x and 0x1f).toInt()) + 63).toChar())
                x = x shr 5
            }
            out.append((x + 63).toInt().toChar())
        }
        for (p in points) {
            val lat = Math.round(p.latitude * 1e5)
            val lng = Math.round(p.longitude * 1e5)
            put(lat - lastLat)
            put(lng - lastLng)
            lastLat = lat
            lastLng = lng
        }
        return out.toString()
    }

    private fun line(code: String, color: String) =
        BusMapLine(code = code, name = code, kind = "BRT", color = color, shapes = emptyList(), stops = emptyList())

    private fun map(vararg edges: BusMapEdge) = BusMap(
        attribution = "",
        lines = listOf(line("4", "#7E3794"), line("6", "#39B54A"), line("9", "#C0C0C0")),
        edges = edges.toList(),
        haltes = emptyMap(),
        rail = emptyList(),
    )

    private val band15 = BUNDLE_BANDS.first { 15.0 >= it.from && 15.0 < it.to }

    /** A line width in metres at [band15]'s zoom. */
    private val unit15: Double = run {
        val z = (band15.from + band15.to) / 2
        bundleLineWidth(z) * 40_075_016.686 * cos(Math.toRadians(lat0)) / (512 * Math.pow(2.0, z))
    }

    /** The widest step between consecutive points of [points], in metres. */
    private fun widestStep(points: List<GeoPoint>) = points.zipWithNext().maxOf { (a, b) ->
        val (ax, ay) = metres(a)
        val (bx, by) = metres(b)
        hypot(bx - ax, by - ay)
    }

    @Test
    fun `a line through a node is one path, its edges end to end`() {
        val paths = map(
            BusMapEdge(encode(at(0.0, 0.0), at(300.0, 0.0)), listOf("4", "6")),
            BusMapEdge(encode(at(300.0, 0.0), at(600.0, 0.0)), listOf("4", "6")),
        ).bundlePaths()
        assertEquals(listOf("4", "6"), paths.map { it.code })
        assertTrue(paths.all { it.pieces.size == 2 })
    }

    @Test
    fun `a line moving over at a node eases across, with no gap`() {
        // 4 alone east of the node, then beside 6: from the middle to half a width left.
        val paths = map(
            BusMapEdge(encode(at(0.0, 0.0), at(300.0, 0.0)), listOf("4")),
            BusMapEdge(encode(at(300.0, 0.0), at(600.0, 0.0)), listOf("4", "6")),
        ).bundlePaths()
        val four = offsetBundlePath(paths.single { it.code == "4" }, band15)
        val (_, startY) = metres(four.first())
        val (_, endY) = metres(four.last())
        assertEquals(0.0, startY, 0.5)
        // Half a width left of east is north.
        assertEquals(0.5 * unit15, endY, 0.5)
        // One line all the way: no step wider than the straight runs either side make.
        assertTrue(widestStep(four) <= 300.0)
        val ys = four.map { metres(it).second }
        for (i in 1 until ys.size) assertTrue("never back", ys[i] >= ys[i - 1] - 0.01)
    }

    @Test
    fun `a line turning at a node in its place turns as one`() {
        // 4 and 6 east, then north round a corner: 4 on the left both sides, inside the turn.
        val paths = map(
            BusMapEdge(encode(at(0.0, 0.0), at(300.0, 0.0)), listOf("4", "6")),
            BusMapEdge(encode(at(300.0, 0.0), at(300.0, 300.0)), listOf("4", "6")),
        ).bundlePaths()
        val six = offsetBundlePath(paths.single { it.code == "6" }, band15)
        // One path round the corner, outside the turn: rounded, never nearer the node than half a width.
        val cx = 300.0 + 0.5 * unit15
        val cy = -0.5 * unit15
        assertTrue(six.all { hypot(metres(it).first - 300.0, metres(it).second) >= 0.5 * unit15 - 0.5 })
        assertTrue("rounded, not a miter", six.none { hypot(metres(it).first - cx, metres(it).second - cy) < 0.5 })
        // Along each leg half a width out: south of the street going east, east of it going north.
        assertEquals(cy, metres(six.first()).second, 0.5)
        assertEquals(cx, metres(six.last()).first, 0.5)
    }

    @Test
    fun `a line inside a tight corner, further in than the corner is round, never folds over itself`() {
        // 4, 6 and 9 east then north round a corner with 20 m legs either side: 4 a width inside it.
        val paths = map(
            BusMapEdge(encode(at(-300.0, 0.0), at(-20.0, 0.0), at(0.0, 0.0)), listOf("4", "6", "9")),
            BusMapEdge(encode(at(0.0, 0.0), at(0.0, 20.0), at(0.0, 300.0)), listOf("4", "6", "9")),
        ).bundlePaths()
        val four = offsetBundlePath(paths.single { it.code == "4" }, band15, heavier = 2.0).map(::metres)
        val legs = four.zipWithNext()
        for (i in legs.indices) {
            for (j in i + 2 until legs.size) {
                val (a, b) = legs[i]
                val (c, d) = legs[j]
                val d1 = (b.first - a.first) * (c.second - a.second) - (b.second - a.second) * (c.first - a.first)
                val d2 = (b.first - a.first) * (d.second - a.second) - (b.second - a.second) * (d.first - a.first)
                val d3 = (d.first - c.first) * (a.second - c.second) - (d.second - c.second) * (a.first - c.first)
                val d4 = (d.first - c.first) * (b.second - c.second) - (d.second - c.second) * (b.first - c.first)
                assertTrue("legs $i and $j cross", !(d1 * d2 < 0 && d3 * d4 < 0))
            }
        }
    }

    @Test
    fun `zoomed out a street's small bends are straightened, at street zoom they are kept`() {
        // East 600 m with a 12 m kink at the middle.
        val paths = map(
            BusMapEdge(encode(at(0.0, 0.0), at(280.0, 0.0), at(300.0, 12.0), at(320.0, 0.0), at(600.0, 0.0)), listOf("4")),
        ).bundlePaths()
        val four = paths.single()
        val out = BUNDLE_BANDS.first { 12.0 >= it.from && 12.0 < it.to }
        assertTrue(offsetBundlePath(four, out).all { kotlin.math.abs(metres(it).second) < 1.0 })
        assertTrue(offsetBundlePath(four, band15).any { metres(it).second > 6.0 })
    }

    @Test
    fun `where a line's edges branch, it goes on along the straightest and starts the other afresh`() {
        val paths = map(
            BusMapEdge(encode(at(0.0, 0.0), at(300.0, 0.0)), listOf("9")),
            BusMapEdge(encode(at(300.0, 0.0), at(600.0, 10.0)), listOf("9")),
            BusMapEdge(encode(at(300.0, 0.0), at(400.0, -300.0)), listOf("9")),
        ).bundlePaths()
        assertEquals(2, paths.size)
        val long = paths.maxBy { it.pieces.count { p -> !p.lead } }
        assertEquals(2, long.pieces.count { !it.lead })
        assertTrue(metres(long.pieces.last { !it.lead }.points.last()).first > 500.0)
        // The branch led in along the way 9 comes, under it, so it peels off from its place there.
        val branch = paths.minBy { it.pieces.count { p -> !p.lead } }
        assertTrue(branch.pieces.first().lead)
        assertEquals(0.0, metres(branch.pieces.first().points.first()).first, 1.0)
    }

    @Test
    fun `the shipped network draws every line, each edge of it once`() {
        val map = WebMapData.busMap
        val paths = map.bundlePaths()
        val byCode = map.lines.associateBy { it.code }
        // Each edge with a length: a crossing's piece rounded to one point (14, of 11 and C) has none to draw.
        val drawn = map.edges.filter { edge -> id.shiorilabs.commute.core.geo.decodePolyline(edge.shape).toSet().size >= 2 }
        val edgesOf = drawn.flatMap { edge -> map.strokesOf(edge, byCode).flatMap { it.codes } }.groupingBy { it }.eachCount()
        val piecesOf = paths.groupBy { it.code }.mapValues { (_, ps) -> ps.sumOf { p -> p.pieces.count { !it.lead } } }
        assertEquals(edgesOf, piecesOf)
        // Mostly long: a line is a few paths, not its edges one by one.
        assertTrue(paths.size < edgesOf.values.sum() / 3)
    }

    @Test
    fun `the paths' GeoJSON carries a band apiece, every band drawn`() {
        val text = bundlePathsGeoJson(WebMapData.busMap.bundlePaths())
        val features = Json.parseToJsonElement(text).jsonObject["features"]!!.jsonArray
        val bands = features.map { it.jsonObject["properties"]!!.jsonObject[BusMapProps.BAND]!!.jsonPrimitive.int }.toSet()
        assertEquals(BUNDLE_BANDS.map { it.index }.toSet(), bands)
    }
}
