package id.shiorilabs.commute.feature.map.domain

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** Cases from the web's `map-clamp-transform.test.ts` and `map-easing.test.ts`, without the insets. */
class MapCameraTest {

    // The FDTJ world, in a portrait phone's dp.
    private val phone = Viewport(width = 400.0, height = 800.0, worldWidth = 9513.57, worldHeight = 6726.88)

    @Test
    fun `the minimum scale covers the view, so no bars show`() {
        val min = phone.minScale
        assertTrue(phone.worldWidth * min >= phone.width - 1e-9)
        assertTrue(phone.worldHeight * min >= phone.height - 1e-9)
        // On a portrait phone it is the height that binds.
        assertEquals(800.0 / 6726.88, min, 1e-12)
    }

    @Test
    fun `a view not yet measured gets a sane floor`() {
        assertEquals(0.01, Viewport(0.0, 0.0, 100.0, 100.0).minScale, 0.0)
    }

    @Test
    fun `the scale is clamped into min to max`() {
        assertEquals(phone.minScale, phone.clamp(Transform(0.0, 0.0, 0.0001)).scale, 0.0)
        assertEquals(Viewport.MAX_SCALE, phone.clamp(Transform(0.0, 0.0, 9.0)).scale, 0.0)
    }

    @Test
    fun `an edge is never dragged inside the view`() {
        val t = phone.clamp(Transform(tx = 500.0, ty = 300.0, scale = 0.5))
        assertEquals(0.0, t.tx, 0.0)
        assertEquals(0.0, t.ty, 0.0)

        val far = phone.clamp(Transform(tx = -1e6, ty = -1e6, scale = 0.5))
        assertEquals(phone.width - phone.worldWidth * 0.5, far.tx, 1e-9)
        assertEquals(phone.height - phone.worldHeight * 0.5, far.ty, 1e-9)
    }

    @Test
    fun `a pan within bounds passes through untouched`() {
        val t = Transform(tx = -1000.0, ty = -500.0, scale = 0.5)
        assertEquals(t, phone.clamp(t))
    }

    @Test
    fun `at the minimum scale the binding axis sits flush and only the other pans`() {
        val t = phone.clamp(Transform(tx = -500.0, ty = 123.0, scale = phone.minScale))
        assertEquals(0.0, t.ty, 1e-9)
        assertEquals(-500.0, t.tx, 1e-9)
    }

    // The phone sheet's peek, and a portrait phone under it.
    private val peek = phone.height * Viewport.PEEK_FRACTION
    private val sheeted = phone.copy(insetBottom = peek)
    private val bogorY = 6556.9

    @Test
    fun `a sheet lets the bottom edge slide clear of it but no further`() {
        val t = sheeted.clamp(Transform(0.0, -1e6, sheeted.minScale))
        assertEquals(phone.height - peek - phone.worldHeight * sheeted.minScale, t.ty, 1e-9)
    }

    @Test
    fun `a sheet brings Bogor out from under it, where no sheet pins it underneath`() {
        val scale = phone.minScale
        val wanted = Transform(0.0, (phone.height - peek) / 2 - bogorY * scale, scale)
        assertTrue(bogorY * scale + sheeted.clamp(wanted).ty < phone.height - peek)
        val pinned = phone.clamp(wanted)
        assertEquals(0.0, pinned.ty, 0.0)
        assertTrue(bogorY * scale + pinned.ty > phone.height - peek)
    }

    @Test
    fun `a sheet leaves the top edge flush and the horizontal axis alone`() {
        assertEquals(0.0, sheeted.clamp(Transform(0.0, 1e6, sheeted.minScale)).ty, 0.0)
        val t = Transform(-300.0, 0.0, 0.5)
        assertEquals(phone.clamp(t).tx, sheeted.clamp(t).tx, 0.0)
    }

    @Test
    fun `a sheet taller than the view degrades to a finite clamp`() {
        val out = phone.copy(height = 200.0, insetBottom = 9999.0).clamp(Transform(0.0, -5000.0, phone.minScale))
        assertTrue(out.ty.isFinite())
        assertTrue(out.ty <= 0)
    }

    @Test
    fun `focusing puts a point in the middle of what the sheet leaves`() {
        val t = sheeted.focus(Transform(0.0, 0.0, 0.5), 3600.0, 3700.0)
        assertEquals(phone.width / 2, t.tx + 3600.0 * t.scale, 1e-9)
        assertEquals((phone.height - peek) / 2, t.ty + 3700.0 * t.scale, 1e-9)
    }

    @Test
    fun `zooming keeps the world point under the anchor fixed`() {
        val t = Transform(tx = -1200.0, ty = -900.0, scale = 0.4)
        val zoomed = phone.zoomAt(t, px = 150.0, py = 420.0, factor = 1.7)
        assertEquals(t.worldX(150.0), zoomed.worldX(150.0), 1e-9)
        assertEquals(t.worldY(420.0), zoomed.worldY(420.0), 1e-9)
        assertEquals(0.68, zoomed.scale, 1e-12)
    }

    @Test
    fun `the map opens centred on its station, no further out than half scale`() {
        val t = phone.initial(x = 3600.0, y = 3700.0)
        assertEquals(0.5, t.scale, 0.0)
        assertEquals(200.0, t.tx + 3600.0 * t.scale, 1e-9)
        assertEquals(400.0, t.ty + 3700.0 * t.scale, 1e-9)
    }

    @Test
    fun `without a station the map opens on its middle`() {
        val t = phone.initial()
        assertEquals(phone.worldWidth / 2, t.worldX(phone.width / 2), 1e-9)
        assertEquals(phone.worldHeight / 2, t.worldY(phone.height / 2), 1e-9)
    }

    @Test
    fun `a fling decays to a stop`() {
        var t = Transform(tx = -2000.0, ty = -1000.0, scale = 0.5)
        var fling = Fling(vx = 2.0, vy = 0.0)
        var frames = 0
        while (!fling.isSpent && frames < 1000) {
            val (moved, left) = fling.step(t, 16.0, phone)
            t = moved
            fling = left
            frames++
        }
        assertTrue("stopped after $frames frames", frames in 10..200)
        assertTrue(t.tx > -2000.0)
    }

    @Test
    fun `a fling into the edge stops at it`() {
        val (moved, left) = Fling(vx = 50.0, vy = 0.0).step(Transform(tx = -10.0, ty = -1000.0, scale = 0.5), 16.0, phone)
        assertEquals(0.0, moved.tx, 0.0)
        assertEquals(0.0, left.vx, 0.0)
    }

    @Test
    fun `the idle glide closes on its target and settles`() {
        val goal = Transform(100.0, 50.0, 1.0)
        var t = Transform(0.0, 0.0, 0.5)
        repeat(60) { t = lerpTransform(t, goal, 16.0) }
        assertTrue(settled(t, goal))
    }

    @Test
    fun `a flight lands exactly on its destination`() {
        val flight = Flight(Transform(0.0, 0.0, 0.5), Transform(-300.0, -200.0, 1.0), Flight.ZOOM_STEP_MS)
        assertEquals(flight.to, flight.at(Flight.ZOOM_STEP_MS))
        assertEquals(flight.from, flight.at(0.0))
        assertTrue(flight.isOver(Flight.ZOOM_STEP_MS))
    }

    @Test
    fun `the camera curve lands exactly on both ends and clamps outside them`() {
        assertEquals(0.0, easeCameraFlight(0.0), 0.0)
        assertEquals(1.0, easeCameraFlight(1.0), 0.0)
        assertEquals(0.0, easeCameraFlight(-0.5), 0.0)
        assertEquals(1.0, easeCameraFlight(1.5), 0.0)
    }

    @Test
    fun `the camera curve rises monotonically, never overshoots, and front-loads`() {
        var previous = 0.0
        for (i in 1..1000) {
            val y = easeCameraFlight(i / 1000.0)
            assertTrue(y >= previous - 1e-12)
            assertTrue(y <= 1.0)
            previous = y
        }
        // About 81% of the way by half time, as the web pins it.
        assertEquals(0.81, easeCameraFlight(0.5), 0.02)
    }
}
