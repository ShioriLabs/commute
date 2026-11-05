package id.shiorilabs.commute.feature.map.render

import id.shiorilabs.commute.feature.map.domain.CutShape
import id.shiorilabs.commute.feature.map.domain.MapTreatment
import id.shiorilabs.commute.feature.map.domain.Rgb
import id.shiorilabs.commute.feature.map.domain.Ring
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Test

/** The layout renderer.cpp's `OverlayLayout` reads; a change here needs one there. */
class OverlayPackTest {

    @Test
    fun `nothing to draw is just the header, zeroed`() {
        assertArrayEquals(FloatArray(OVERLAY_HEADER), packOverlay(MapTreatment.None, emptyList()), 0f)
    }

    @Test
    fun `the treatment, the ring, the holes and the pills land where the renderer reads them`() {
        val treatment = MapTreatment(
            fade = 0.6,
            desaturate = 0.25,
            cuts = listOf(CutShape(1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 0.5)),
            feather = 26.0,
            ring = Ring(CutShape(10.0, 20.0, 30.0, 40.0, 50.0, 60.0), Rgb(0.1, 0.2, 0.3), offset = 8.0, width = 5.0, alpha = 0.9),
        )
        val pill = Pill(7.0, 8.0, 9.0, 10.0, 11.0, 12.0, 1.0, 0.0, 0.6, 0.3)
        val packed = packOverlay(treatment, listOf(pill, pill))

        assertEquals(OVERLAY_HEADER + CUT_STRIDE + 2 * PILL_STRIDE, packed.size)
        assertArrayEquals(floatArrayOf(0.6f, 0.25f, 26f, 1f, 2f, 1f), packed.copyOfRange(0, 6), 1e-6f)
        assertArrayEquals(
            floatArrayOf(10f, 20f, 30f, 40f, 50f, 60f, 0.1f, 0.2f, 0.3f, 8f, 5f, 0.9f),
            packed.copyOfRange(6, OVERLAY_HEADER),
            1e-6f,
        )
        assertArrayEquals(floatArrayOf(1f, 2f, 3f, 4f, 5f, 6f, 0.5f), packed.copyOfRange(OVERLAY_HEADER, OVERLAY_HEADER + CUT_STRIDE), 1e-6f)
        val pills = OVERLAY_HEADER + CUT_STRIDE
        assertArrayEquals(
            floatArrayOf(7f, 8f, 9f, 10f, 11f, 12f, 1f, 0f, 0.6f, 0.3f),
            packed.copyOfRange(pills + PILL_STRIDE, pills + 2 * PILL_STRIDE),
            1e-6f,
        )
    }
}
