package id.shiorilabs.commute.feature.map.domain

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Cases from the web's `mapTreatment` and `ringOffsetWorld` suites in `map-renderer.test.ts`. */
class MapTreatmentTest {

    private val marker = MapPoint(id = "KCI-SUD", ax = 100.0, ay = 200.0, bx = 100.0, by = 200.0, r = 20.0)
    private val name = MapPoint(id = "LBL-KCI-SUD", station = "KCI-SUD", ax = 60.0, ay = 260.0, bx = 140.0, by = 260.0, r = 18.0, cr = 6.0, noRing = true)

    private fun selection(fade: Double = SELECTION_FADE_MAX, ring: Double = 1.0, open: Double = 1.0, label: MapPoint? = null) =
        SelectionOverlay(marker, label, Rgb.Neutral, fade, ring, open)

    @Test
    fun `nothing selected or drawn leaves the map alone`() {
        val t = mapTreatment(null)
        assertEquals(0.0, t.fade, 0.0)
        assertEquals(0.0, t.desaturate, 0.0)
        assertEquals(0.0, t.feather, 0.0)
        assertTrue(t.cuts.isEmpty())
        assertNull(t.ring)
    }

    @Test
    fun `a selection fades the map and punches a hole at its shape and its name`() {
        val t = mapTreatment(selection(label = name))
        assertEquals(SELECTION_FADE_MAX, t.fade, 0.0)
        assertEquals(SELECTION_DESATURATE_MAX, t.desaturate, 1e-12)
        assertEquals(SPOTLIGHT_FEATHER_WORLD, t.feather, 0.0)
        assertEquals(listOf(100.0, 60.0), t.cuts.map { it.ax })
        assertEquals(20.0, t.cuts[0].r, 0.0)
        assertEquals(6.0, t.cuts[1].cr, 0.0)
    }

    @Test
    fun `fade and desaturate keep their proportion mid-animation`() {
        val t = mapTreatment(selection(fade = SELECTION_FADE_MAX / 2))
        assertEquals(SELECTION_DESATURATE_MAX / 2, t.desaturate, 1e-12)
    }

    @Test
    fun `a selection over a route fades once, not twice, and still cuts its hole`() {
        val t = mapTreatment(selection(), route = RouteTreatment(fade = 0.6, desaturate = 0.25))
        assertEquals(0.6, t.fade, 0.0)
        assertTrue(t.desaturate <= 1)
        assertEquals(1, t.cuts.size)
    }

    @Test
    fun `a route alone fades the whole map and cuts nothing`() {
        val t = mapTreatment(null, route = RouteTreatment(fade = 0.6, desaturate = 0.25))
        assertEquals(0.6, t.fade, 0.0)
        assertEquals(0.0, t.feather, 0.0)
        assertTrue(t.cuts.isEmpty())
    }

    @Test
    fun `the hole goes once the selection has faded out`() {
        val t = mapTreatment(selection(fade = 0.0, ring = 0.0, open = 0.0))
        assertEquals(0.0, t.feather, 0.0)
        assertTrue(t.cuts.isEmpty())
        assertNull(t.ring)
    }

    @Test
    fun `an isolate's holes open with its own progress, and the closing line's shrink`() {
        val shape = CutShape(0.0, 0.0, 100.0, 0.0, 10.0, 10.0)
        val t = mapTreatment(
            null,
            isolate = LineIsolateOverlay(listOf(shape), fadeAlpha = 0.6, openProgress = 0.3, closingShapes = listOf(shape), closingProgress = 0.7),
        )
        assertEquals(listOf(0.3, 0.7), t.cuts.map { it.alpha })
    }

    @Test
    fun `the ring settles from wide to its resting offset`() {
        assertEquals(RING_MAX_OFFSET_WORLD, ringOffsetWorld(0.0), 0.0)
        assertEquals(RING_REST_OFFSET_WORLD, ringOffsetWorld(1.0), 0.0)
        val ring = mapTreatment(selection(ring = 1.0)).ring!!
        assertEquals(RING_REST_OFFSET_WORLD, ring.offset, 0.0)
        assertEquals(RING_WIDTH_WORLD, ring.width, 0.0)
    }

    @Test
    fun `a new treatment starts from the strongest fade on screen`() {
        assertEquals(0.0, seedFadeFrom(), 0.0)
        assertEquals(0.6, seedFadeFrom(0.2, null, 0.6), 0.0)
    }

    @Test
    fun `a marker's name is the nearest label of its station`() {
        val far = name.copy(ax = 900.0, bx = 980.0)
        val other = name.copy(id = "LBL-KCI-THB", station = "KCI-THB")
        assertEquals(name, markerLabel(marker, listOf(far, other, name)))
        assertNull(markerLabel(name, listOf(name)))
        assertNull(markerLabel(marker, listOf(other)))
    }

    @Test
    fun `colours parse from the API's hex`() {
        assertEquals(Rgb(1.0, 0.0, 0x40 / 255.0), Rgb.parse("#FF0040"))
        assertNull(Rgb.parse("red"))
        assertNull(Rgb.parse(null))
    }
}
