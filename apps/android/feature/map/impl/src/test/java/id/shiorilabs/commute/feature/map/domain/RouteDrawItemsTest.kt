package id.shiorilabs.commute.feature.map.domain

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.abs
import kotlin.math.hypot

/** The route cases of the web's `map-renderer.test.ts`. */
class RouteDrawItemsTest {

    private fun xy(vararg pts: Pair<Number, Number>) = pts.map { it.first.toDouble() to it.second.toDouble() }
    private fun List<WorldPoint>.xy() = map { it.x to it.y }

    @Test
    fun `a walk at a real angle goes diagonal first, then straight`() {
        assertEquals(xy(0 to 0, 60 to 60, 200 to 60), octilinearPath(0.0, 0.0, 200.0, 60.0).xy())
        assertEquals(xy(0 to 0, -70 to -70, -70 to -190), octilinearPath(0.0, 0.0, -70.0, -190.0).xy())
        // 4.9° off vertical: past the tolerance.
        assertEquals(xy(0 to 0, -18 to 18, -18 to 209), octilinearPath(0.0, 0.0, -18.0, 209.0).xy())
    }

    @Test
    fun `a walk within 2 degrees of an octilinear direction is one straight line`() {
        assertEquals(xy(0 to 0, 200 to 0), octilinearPath(0.0, 0.0, 200.0, 0.0).xy())
        assertEquals(xy(0 to 0, 5 to 200), octilinearPath(0.0, 0.0, 5.0, 200.0).xy())
        assertEquals(xy(0 to 0, 50 to -50), octilinearPath(0.0, 0.0, 50.0, -50.0).xy())
        assertEquals(xy(0 to 0, 100 to 103), octilinearPath(0.0, 0.0, 100.0, 103.0).xy())
    }

    @Test
    fun `a straight near-axis walk bulges to the side asked for`() {
        assertEquals(xy(0 to 0, 60 to 60, 140 to 60, 200 to 0), octilinearPath(0.0, 0.0, 200.0, 0.0, 1).xy())
        assertEquals(xy(0 to 0, 60 to 60, 60 to 140, 0 to 200), octilinearPath(0.0, 0.0, 0.0, 200.0, 1).xy())
        val path = octilinearPath(0.0, 0.0, -5.0, 200.0, -1)
        assertEquals(xy(0 to 0, -60 to 60, -60 to 145, -5 to 200), path.xy())
        for (i in 1 until path.size) {
            val ddx = abs(path[i].x - path[i - 1].x)
            val ddy = abs(path[i].y - path[i - 1].y)
            assertTrue(ddx == 0.0 || ddy == 0.0 || ddx == ddy)
        }
    }

    @Test
    fun `a bent or near-45 walk never bulges`() {
        assertEquals(xy(0 to 0, 60 to 60, 200 to 60), octilinearPath(0.0, 0.0, 200.0, 60.0, 1).xy())
        assertEquals(xy(0 to 0, 100 to 103), octilinearPath(0.0, 0.0, 100.0, 103.0, 1).xy())
    }

    @Test
    fun `a walk bulges the same way in both directions, and less when short`() {
        assertEquals(octilinearPath(0.0, 0.0, -5.0, 200.0, -1).reversed().xy(), octilinearPath(-5.0, 200.0, 0.0, 0.0, -1).xy())
        assertEquals(octilinearPath(0.0, 0.0, 200.0, 5.0, 1).reversed().xy(), octilinearPath(200.0, 5.0, 0.0, 0.0, 1).xy())
        assertEquals(xy(0 to 0, 15 to 15, 30 to 0), octilinearPath(0.0, 0.0, 30.0, 0.0, 1).xy())
    }

    @Test
    fun `a straight path keeps no corner to round`() {
        assertEquals(xy(0 to 0, 100 to 0), roundCorners(listOf(WorldPoint(0.0, 0.0), WorldPoint(100.0, 0.0)), 60.0).xy())
    }

    @Test
    fun `a corner becomes an arc tangent to both runs`() {
        val out = roundCorners(listOf(WorldPoint(0.0, 0.0), WorldPoint(100.0, 0.0), WorldPoint(100.0, 100.0)), 20.0)
        assertEquals(WorldPoint(0.0, 0.0), out.first())
        assertEquals(WorldPoint(100.0, 100.0), out.last())
        val arc = out.subList(1, out.size - 1)
        assertEquals(80.0, arc.first().x, 1e-6)
        assertEquals(0.0, arc.first().y, 1e-6)
        assertEquals(100.0, arc.last().x, 1e-6)
        assertEquals(20.0, arc.last().y, 1e-6)
        for (p in arc) assertEquals(20.0, hypot(p.x - 80, p.y - 20), 1e-6)
    }

    @Test
    fun `the radius shrinks to fit a short run`() {
        val arc = roundCorners(listOf(WorldPoint(0.0, 0.0), WorldPoint(10.0, 0.0), WorldPoint(10.0, 10.0)), 60.0).let { it.subList(1, it.size - 1) }
        assertEquals(5.0, arc.first().x, 1e-6)
        assertEquals(5.0, arc.last().y, 1e-6)
    }

    @Test
    fun `dots land on both ends, the spacing stretched to fit`() {
        assertTrue(dotPolyline(listOf(WorldPoint(5.0, 5.0), WorldPoint(5.0, 5.0)), 10.0).isEmpty())
        assertEquals(xy(0 to 0, 4 to 0), dotPolyline(listOf(WorldPoint(0.0, 0.0), WorldPoint(4.0, 0.0)), 10.0).xy())
        val dots = dotPolyline(listOf(WorldPoint(0.0, 0.0), WorldPoint(105.0, 0.0)), 10.0)
        // round(10.5) is 11 intervals, half up.
        assertEquals(12, dots.size)
        assertEquals(105.0, dots.last().x, 1e-6)
        for (i in 1 until dots.size) assertEquals(105.0 / 11, dots[i].x - dots[i - 1].x, 1e-6)
    }

    @Test
    fun `dots are spaced by arc length across a bend`() {
        val dots = dotPolyline(listOf(WorldPoint(0.0, 0.0), WorldPoint(10.0, 0.0), WorldPoint(10.0, 10.0)), 5.0)
        assertEquals(5, dots.size)
        assertEquals(10.0, dots[2].x, 1e-6)
        assertEquals(0.0, dots[2].y, 1e-6)
        assertEquals(10.0, dots[3].x, 1e-6)
        assertEquals(5.0, dots[3].y, 1e-6)
    }

    private val red = Rgb(1.0, 0.0, 0.0)
    private val overlay = RouteOverlay(
        segments = listOf(
            RouteSegment(0.0, 0.0, 100.0, 0.0, 7.0, red, RouteSegmentKind.RIDE),
            RouteSegment(100.0, 0.0, 200.0, 0.0, 7.0, Rgb(0.0, 0.0, 1.0), RouteSegmentKind.RIDE),
        ),
        pins = listOf(RoutePin(0.0, 0.0, RoutePinKind.ORIGIN), RoutePin(200.0, 0.0, RoutePinKind.DESTINATION)),
    )
    private val items = routeDrawItems(overlay)

    @Test
    fun `every casing is painted before any fill`() {
        val lastCasing = items.indexOfLast { it.r == 7 + ROUTE_CASING_EXTRA_WORLD }
        assertTrue(lastCasing >= 1)
        assertTrue(items.indexOfFirst { it.color == red } > lastCasing)
    }

    @Test
    fun `pins are painted last, as discs on their centres`() {
        val discs = items.filter { it.ax == it.bx && it.ay == it.by }
        assertTrue(discs.size >= 4)
        val lastSegment = items.indexOfLast { it.r == 7.0 || it.r == 7 + ROUTE_CASING_EXTRA_WORLD }
        assertTrue(items.indexOf(discs.first()) > lastSegment)
        assertTrue(discs.all { it.ax == 0.0 || it.ax == 200.0 })
    }

    @Test
    fun `the origin's arrow points up and the destination's down`() {
        // y grows down, so an up arrow's tip is its smallest y.
        fun glyphAt(x: Double) = items.filter { it.ax != it.bx || it.ay != it.by }.filter { abs(it.ax - x) <= 12 && abs(it.bx - x) <= 12 }
        val origin = glyphAt(0.0)
        val destination = glyphAt(200.0)
        assertEquals(3, origin.size)
        assertEquals(3, destination.size)
        val originTip = origin.minOf { minOf(it.ay, it.by) }
        val destinationTip = destination.maxOf { maxOf(it.ay, it.by) }
        assertEquals(3, origin.count { it.ay == originTip || it.by == originTip })
        assertEquals(3, destination.count { it.ay == destinationTip || it.by == destinationTip })
        assertTrue(originTip < 0)
        assertTrue(destinationTip > 0)
    }

    @Test
    fun `a pin's paint stays inside the margin the bounds promise`() {
        val margin = ROUTE_PIN_RADIUS_WORLD + ROUTE_CASING_EXTRA_WORLD
        for (item in items) {
            for ((x, y) in listOf(item.ax to item.ay, item.bx to item.by)) {
                val nearOrigin = hypot(x, y) <= margin
                val nearDestination = hypot(x - 200, y) <= margin
                if (!nearOrigin && !nearDestination) continue
                val cx = if (nearOrigin) 0.0 else 200.0
                assertTrue(hypot(x - cx, y) + item.r <= margin + 1e-9)
            }
        }
    }
}
