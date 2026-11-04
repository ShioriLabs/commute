package id.shiorilabs.commute.feature.map.domain

import id.shiorilabs.commute.feature.map.domain.MapGestures.Event
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class MapGesturesTest {

    private val gestures = MapGestures()

    @Test
    fun `a still touch is a tap, reported as it lifts`() {
        assertEquals(listOf(Event.Grabbed), gestures.down(1, 100.0, 100.0, 0))
        gestures.move(1, 103.0, 104.0, 30)
        val up = gestures.up(1, 103.0, 104.0, 60)
        assertEquals(listOf(Event.Tap(103.0, 104.0), Event.Released), up)
    }

    @Test
    fun `a touch moved past the slop is a drag, not a tap`() {
        gestures.down(1, 100.0, 100.0, 0)
        val pan = gestures.move(1, 110.0, 100.0, 16)
        assertEquals(listOf(Event.Pan(10.0, 0.0)), pan)
        val up = gestures.up(1, 110.0, 100.0, 200)
        assertTrue(up.none { it is Event.Tap })
    }

    @Test
    fun `a drag flings from its last moments`() {
        gestures.down(1, 0.0, 0.0, 0)
        gestures.move(1, 50.0, 0.0, 100)
        gestures.move(1, 60.0, 0.0, 110)
        gestures.move(1, 80.0, 0.0, 130)
        val fling = gestures.up(1, 80.0, 0.0, 130).filterIsInstance<Event.Fling>().single()
        // Only the last 80 ms count: 60 → 80 over 20 ms, the 0 → 50 run-up long gone.
        assertEquals(1.0, fling.vx, 1e-9)
        assertEquals(0.0, fling.vy, 0.0)
    }

    @Test
    fun `a quick second tap nearby is a double tap`() {
        gestures.down(1, 100.0, 100.0, 0)
        gestures.up(1, 100.0, 100.0, 50)
        gestures.down(2, 110.0, 105.0, 200)
        val second = gestures.up(2, 110.0, 105.0, 250)
        assertEquals(listOf(Event.DoubleTap(110.0, 105.0), Event.Released), second)
    }

    @Test
    fun `a second tap too late or too far is a tap of its own`() {
        gestures.down(1, 100.0, 100.0, 0)
        gestures.up(1, 100.0, 100.0, 50)
        gestures.down(2, 100.0, 100.0, 400)
        assertTrue(gestures.up(2, 100.0, 100.0, 420).first() is Event.Tap)

        gestures.down(3, 200.0, 100.0, 500)
        assertTrue(gestures.up(3, 200.0, 100.0, 520).first() is Event.Tap)
    }

    @Test
    fun `a tap that opened something isn't the first half of a double tap`() {
        gestures.down(1, 100.0, 100.0, 0)
        gestures.up(1, 100.0, 100.0, 50)
        gestures.forgetTap()
        gestures.down(2, 100.0, 100.0, 200)
        assertTrue(gestures.up(2, 100.0, 100.0, 250).first() is Event.Tap)
    }

    @Test
    fun `a pinch zooms about where it began, with no pan`() {
        gestures.down(1, 100.0, 100.0, 0)
        assertEquals(listOf(Event.PinchStarted), gestures.down(2, 200.0, 100.0, 10))
        // Both fingers drift right while spreading: the anchor stays at the starting midpoint.
        gestures.move(1, 90.0, 100.0, 20)
        val pinch = gestures.move(2, 250.0, 100.0, 20).single() as Event.Pinch
        assertEquals(150.0, pinch.anchorX, 0.0)
        assertEquals(100.0, pinch.anchorY, 0.0)
        assertEquals(1.6, pinch.factor, 1e-9)
    }

    @Test
    fun `a pinch never flings and never taps, even as its last finger lifts`() {
        gestures.down(1, 100.0, 100.0, 0)
        gestures.down(2, 200.0, 100.0, 10)
        gestures.move(2, 300.0, 100.0, 30)
        val first = gestures.up(2, 300.0, 100.0, 40)
        assertTrue(first.none { it is Event.Fling || it is Event.Tap })
        // The finger left behind pans, but doesn't tap.
        assertEquals(listOf(Event.Pan(2.0, 0.0)), gestures.move(1, 102.0, 100.0, 50))
        val last = gestures.up(1, 102.0, 100.0, 60)
        assertTrue(last.none { it is Event.Tap })
        assertEquals(Event.Released, last.last())
    }

    @Test
    fun `a cancelled touch neither taps nor flings`() {
        gestures.down(1, 0.0, 0.0, 0)
        gestures.move(1, 50.0, 0.0, 16)
        assertEquals(listOf(Event.Released), gestures.cancel())
        assertEquals(emptyList<Event>(), gestures.up(1, 50.0, 0.0, 30))
    }
}
