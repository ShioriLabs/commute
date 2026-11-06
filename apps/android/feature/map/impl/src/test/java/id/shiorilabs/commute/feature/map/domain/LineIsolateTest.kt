package id.shiorilabs.commute.feature.map.domain

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The web's `map-line-isolate.test.ts`, then the isolate's phases. */
class LineIsolateTest {

    private val bogor = MapLine(
        key = "KCI:B", operator = "KCI", code = "B", name = "Lin Bogor", color = "#EE3D43", r = 12.5,
        segments = listOf(
            MapLineSegment("TRUNK", listOf(listOf(0.0, 0.0, 100.0, 0.0), listOf(100.0, 0.0, 200.0, 0.0)), listOf("KCI-A", "KCI-B")),
            MapLineSegment("RAMP", listOf(listOf(200.0, 0.0, 200.0, 100.0)), listOf("KCI-B", "KCI-C")),
        ),
    )
    private val cikarang = MapLine(
        key = "KCI:C", operator = "KCI", code = "C", name = "Lin Cikarang", color = "#25B8EB", r = 12.5,
        segments = listOf(MapLineSegment("TRUNK", listOf(listOf(0.0, 500.0, 200.0, 500.0)), listOf("KCI-D"))),
    )
    private val lines = listOf(bogor, cikarang)

    private fun dot(id: String, x: Double, y: Double) = MapPoint(id = id, ax = x, ay = y, bx = x, by = y, r = 12.0)
    private fun label(station: String, x: Double) =
        MapPoint(id = "LBL-$station", station = station, ax = x, ay = 40.0, bx = x + 60, by = 40.0, r = 20.0, noRing = true)

    private val points = listOf(dot("KCI-A", 0.0, 0.0), dot("KCI-B", 100.0, 0.0), dot("KCI-C", 200.0, 100.0))
    private val labels = listOf(label("KCI-A", 0.0), label("KCI-B", 100.0))

    @Test
    fun `it holds the traced stroke, the markers and the names`() {
        val shapes = lineCutShapes(bogor, points, labels)
        // 3 edges + 3 markers + 2 names (KCI-C has none drawn).
        assertEquals(8, shapes.size)
        assertEquals(3, shapes.count { it.r == 12.5 })
    }

    @Test
    fun `a junction station is punched once, not once per branch`() {
        // KCI-B ends the trunk and starts the ramp.
        assertEquals(3, lineCutShapes(bogor, points, emptyList()).count { it.r == 12.0 })
    }

    @Test
    fun `edges are capsules`() {
        val edge = lineCutShapes(bogor, points, emptyList()).first()
        assertEquals(edge.r, edge.cr, 0.0)
    }

    @Test
    fun `a station with no drawn point is skipped`() {
        assertEquals(3, lineCutShapes(bogor, emptyList(), emptyList()).size)
    }

    @Test
    fun `an exact id beats a twice-drawn halte's alias`() {
        val alias = dot("KCI-A-b", 50.0, 50.0).copy(station = "KCI-A")
        val shapes = lineCutShapes(bogor, listOf(alias, dot("KCI-A", 0.0, 0.0)), emptyList())
        assertTrue(shapes.any { it.r == 12.0 && it.ax == 0.0 })
        assertFalse(shapes.any { it.ax == 50.0 })
    }

    @Test
    fun `a tap on a stroke finds its line`() {
        assertEquals(listOf("KCI:B"), linesNear(lines, 50.0, 0.0, 8.0))
    }

    @Test
    fun `a tap off every stroke finds nothing`() {
        assertEquals(emptyList<String>(), linesNear(lines, 50.0, 300.0, 8.0))
    }

    @Test
    fun `every line sharing a trunk comes back, nearest first`() {
        // An interlined trunk carries several, and the geometry holds nothing to prefer one by.
        val shared = listOf(bogor, cikarang.copy(segments = listOf(MapLineSegment("TRUNK", listOf(listOf(0.0, 4.0, 200.0, 4.0)), emptyList()))))
        assertEquals(listOf("KCI:B", "KCI:C"), linesNear(shared, 50.0, 0.0, 8.0))
        assertEquals(listOf("KCI:C", "KCI:B"), linesNear(shared, 50.0, 4.0, 8.0))
    }

    @Test
    fun `a line's two direction strokes are one candidate`() {
        // The artwork draws each direction apart, ~22 units, both the same line: no chooser.
        val twin = bogor.copy(
            segments = listOf(
                MapLineSegment("TRUNK", listOf(listOf(0.0, 0.0, 200.0, 0.0)), emptyList()),
                MapLineSegment("TRUNK", listOf(listOf(0.0, 22.0, 200.0, 22.0)), emptyList()),
            ),
        )
        assertEquals(listOf("KCI:B"), linesNear(listOf(twin), 100.0, 11.0, 8.0))
    }

    @Test
    fun `lines are found by key, none for one never traced`() {
        assertEquals("Lin Cikarang", lines.lineOf("KCI:C")?.name)
        assertNull(lines.lineOf("TJ:1"))
    }

    private val shapes = listOf(CutShape(0.0, 0.0, 100.0, 0.0, 12.5, 12.5))
    private val otherShapes = listOf(CutShape(0.0, 500.0, 200.0, 500.0, 12.5, 12.5))

    @Test
    fun `it fades in on the spotlight's clock, its holes opening apart from the fade`() {
        val isolate = LineIsolate("KCI:B", shapes, startMs = 0, fadeFrom = 0.6)
        val halfway = isolate.frame(175)!!
        assertEquals(SELECTION_FADE_MAX, halfway.fadeAlpha, 1e-9)
        assertEquals(0.875, halfway.openProgress, 1e-9)
        isolate.frame(350)
        assertFalse(isolate.isAnimating)
        assertEquals(1.0, isolate.frame(10_000)!!.openProgress, 0.0)
    }

    @Test
    fun `it fades out from wherever it had got to, then is gone`() {
        val isolate = LineIsolate("KCI:B", shapes, startMs = 0)
        isolate.frame(175)
        isolate.exit(175)
        assertTrue(isolate.isLeaving)
        val half = isolate.frame(175 + 110)!!
        assertEquals(SELECTION_FADE_MAX * 0.875 * 0.5, half.fadeAlpha, 1e-9)
        assertEquals(0.875 * 0.5, half.openProgress, 1e-9)
        isolate.frame(175 + 220)
        assertTrue(isolate.isGone)
        assertNull(isolate.frame(1_000))
    }

    @Test
    fun `switching lines crosses the two, the old one closing from how open it was`() {
        val first = LineIsolate("KCI:B", shapes, startMs = 0)
        first.frame(175)
        val second = LineIsolate.after(first, "KCI:C", otherShapes, nowMs = 175)
        // The fade carries on; the old line starts closing from 0.875 open.
        val start = second.frame(175)!!
        assertEquals(first.lastFade, start.fadeAlpha, 1e-9)
        assertEquals(shapes, start.closingShapes)
        assertEquals(0.875, start.closingProgress, 1e-9)
        val landed = second.frame(175 + 350)!!
        assertEquals(0.0, landed.closingProgress, 0.0)
        assertTrue(landed.closingShapes.isEmpty())
    }

    @Test
    fun `the same line again closes no copy of itself`() {
        val first = LineIsolate("KCI:B", shapes, startMs = 0)
        first.frame(350)
        val again = LineIsolate.after(first, "KCI:B", shapes, nowMs = 400)
        assertTrue(again.frame(400)!!.closingShapes.isEmpty())
    }

    @Test
    fun `taking over from a station's spotlight starts from its fade`() {
        // Isolating from an open station sheet once dipped through brighter as the spotlight fell
        // away faster than the isolate rose.
        val isolate = LineIsolate.after(null, "KCI:B", shapes, nowMs = 0, alsoDrawn = 0.6)
        assertEquals(0.6, isolate.frame(0)!!.fadeAlpha, 1e-9)
    }

    @Test
    fun `a switch cut short by a dismissal finishes leaving from where it got to`() {
        val first = LineIsolate("KCI:B", shapes, startMs = 0)
        first.frame(350)
        val second = LineIsolate.after(first, "KCI:C", otherShapes, nowMs = 350)
        val mid = second.frame(350 + 175)!!.closingProgress
        second.exit(350 + 175)
        assertEquals(mid, second.frame(350 + 175)!!.closingProgress, 1e-9)
    }
}
