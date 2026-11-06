package id.shiorilabs.commute.feature.map.domain

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class RiderSpotTest {

    private fun pt(id: String, x: Double, y: Double) = MapPoint(id = id, ax = x - 10, ay = y, bx = x + 10, by = y, r = 5.0)

    // A ride east along y = 0 through three stops, a walk, then a ride south from (400, 100).
    private val points = listOf(
        pt("KCI-AAA", 0.0, 0.0), pt("KCI-BBB", 100.0, 0.0), pt("KCI-CCC", 300.0, 0.0),
        pt("MRT-DDD", 400.0, 100.0), pt("MRT-EEE", 400.0, 300.0),
    )
    private val legs = listOf(
        RouteLeg.Ride("KCI:C", "KCI", listOf("KCI-AAA", "KCI-BBB", "KCI-CCC")),
        RouteLeg.Walk("KCI-CCC", "MRT-DDD"),
        RouteLeg.Ride("MRTJ:M", "MRTJ", listOf("MRT-DDD", "MRT-EEE")),
    )
    private val model = buildRouteOverlayModel(legs, "KCI-AAA", "MRT-EEE", points, { "#FF0000" })!!

    private fun progress(legIndex: Int, position: Double = 0.0, riding: Boolean = true, arrived: Boolean = false, walkingFrom: Int? = null) =
        RideProgress(legIndex, riding, arrived, position, confirmed = true, walkingFromLeg = walkingFrom)

    private fun RiderSpot?.xy() = this?.at?.let { it.x to it.y }

    @Test
    fun `waiting to board, the rider is at the boarding stop`() {
        assertEquals(0.0 to 0.0, riderSpot(model, progress(0, riding = false)).xy())
        assertEquals(400.0 to 100.0, riderSpot(model, progress(2, riding = false)).xy())
    }

    @Test
    fun `riding, the rider is between the two stops by the fraction, along the drawing`() {
        assertEquals(50.0 to 0.0, riderSpot(model, progress(0, 0.5)).xy())
        // From the second stop (100) to the third (300), three quarters of the way.
        assertEquals(250.0 to 0.0, riderSpot(model, progress(0, 1.75)).xy())
        assertEquals(400.0 to 200.0, riderSpot(model, progress(2, 0.5)).xy())
    }

    @Test
    fun `walking, the rider is where the ride before ended, and arrived, at the destination`() {
        assertEquals(300.0 to 0.0, riderSpot(model, progress(2, riding = false, walkingFrom = 0)).xy())
        assertEquals(400.0 to 300.0, riderSpot(model, progress(2, arrived = true)).xy())
    }

    @Test
    fun `a position past the ride's end stays at its last stop`() {
        assertEquals(300.0 to 0.0, riderSpot(model, progress(0, 7.0)).xy())
    }

    @Test
    fun `a ride the map doesn't draw has no rider`() {
        val undrawn = buildRouteOverlayModel(listOf(RouteLeg.Ride("TJ:1", "TJ", listOf("TJ-X", "TJ-Y"))), "KCI-AAA", null, points, { null })!!
        assertNull(riderSpot(undrawn, progress(0, 0.5)))
    }

    @Test
    fun `only what is behind the rider is greyed`() {
        val ridingFirst = riddenSegments(model, progress(0, 1.5))
        // Up to x = 200, halfway from the second stop to the third, nothing of the second ride.
        assertEquals(200.0, ridingFirst.maxOf { maxOf(it.ax, it.bx) }, 1e-9)
        assertTrue(ridingFirst.all { it.ay == 0.0 && it.by == 0.0 })

        val waitingSecond = riddenSegments(model, progress(2, riding = false))
        assertEquals(300.0, waitingSecond.maxOf { maxOf(it.ax, it.bx) }, 1e-9)
        assertTrue(waitingSecond.none { it.ax == 400.0 })

        val arrived = riddenSegments(model, progress(2, arrived = true))
        assertTrue(arrived.any { it.ax == 400.0 && it.by == 300.0 })
        assertTrue(riddenSegments(model, progress(0, riding = false)).isEmpty())
    }

    @Test
    fun `a spot only the timetable gives is drawn as a ring`() {
        val at = RiderSpot(WorldPoint(0.0, 0.0), confirmed = false)
        assertEquals(3, riderDrawItems(at).size)
        assertEquals(2, riderDrawItems(at.copy(confirmed = true)).size)
    }
}
