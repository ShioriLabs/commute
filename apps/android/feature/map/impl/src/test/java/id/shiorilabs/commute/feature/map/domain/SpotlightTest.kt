package id.shiorilabs.commute.feature.map.domain

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SpotlightTest {

    private val marker = MapPoint(id = "KCI-SUD", ax = 0.0, ay = 0.0, bx = 0.0, by = 0.0, r = 20.0)

    @Test
    fun `it comes in over its in time on an ease-out, then holds`() {
        val spot = Spotlight(marker, null, Rgb.Neutral, startMs = 0)
        val halfway = spot.frame(175)!!
        // Ease-out cubic at half time: 1 - 0.5^3.
        assertEquals(SELECTION_FADE_MAX * 0.875, halfway.fadeAlpha, 1e-9)
        assertEquals(0.875, halfway.ringProgress, 1e-9)
        assertTrue(spot.isAnimating)

        val landed = spot.frame(350)!!
        assertEquals(SELECTION_FADE_MAX, landed.fadeAlpha, 0.0)
        assertFalse(spot.isAnimating)
        assertEquals(1.0, spot.frame(10_000)!!.ringProgress, 0.0)
    }

    @Test
    fun `it fades out from wherever it had got to, then is gone`() {
        val spot = Spotlight(marker, null, Rgb.Neutral, startMs = 0)
        spot.frame(175)
        spot.exit(175)
        val half = spot.frame(175 + 110)!!
        assertEquals(SELECTION_FADE_MAX * 0.875 * 0.5, half.fadeAlpha, 1e-9)
        assertEquals(0.5, half.openProgress, 1e-9)
        spot.frame(175 + 220)
        assertTrue(spot.isGone)
        assertNull(spot.frame(1_000))
    }

    @Test
    fun `it carries on from the fade already drawn`() {
        val spot = Spotlight(marker, null, Rgb.Neutral, startMs = 0, fadeFrom = 0.5)
        assertEquals(0.5, spot.frame(0)!!.fadeAlpha, 1e-9)
    }

    @Test
    fun `a shape drawn without a ring still fades and opens, ringless`() {
        val label = marker.copy(id = "LBL-KCI-SUD", station = "KCI-SUD", noRing = true)
        val frame = Spotlight(label, null, Rgb.Neutral, startMs = 0).frame(350)!!
        assertEquals(0.0, frame.ringProgress, 0.0)
        assertEquals(1.0, frame.openProgress, 0.0)
        assertEquals(SELECTION_FADE_MAX, frame.fadeAlpha, 0.0)
    }
}
