package id.shiorilabs.commute.feature.trip.presentation

import id.shiorilabs.commute.core.trip.PositionSource
import id.shiorilabs.commute.core.trip.TripEngine
import id.shiorilabs.commute.core.trip.TripPhase
import id.shiorilabs.commute.feature.trip.ActiveTrip
import id.shiorilabs.commute.feature.trip.NOW
import id.shiorilabs.commute.feature.trip.origin
import id.shiorilabs.commute.feature.trip.plan
import id.shiorilabs.commute.feature.trip.presentation.StopMark.HERE
import id.shiorilabs.commute.feature.trip.presentation.StopMark.PASSED
import id.shiorilabs.commute.feature.trip.presentation.StopMark.UPCOMING
import org.junit.Assert.assertEquals
import org.junit.Test

class StopMarksTest {

    /** Two minutes before the first train: still waiting for it. */
    private val start = TripEngine.start(plan, NOW.minusSeconds(120), hasLocation = true).state

    private fun on(legIndex: Int, position: Double, source: PositionSource = PositionSource.CONFIRMED) = ActiveTrip(
        plan,
        start.copy(legIndex = legIndex, phase = TripPhase.RIDING, position = position, confirmedPosition = position, source = source),
        origin,
    )

    @Test
    fun `at a stop, earlier ones are passed and later ones ahead`() {
        val marks = on(2, 1.0).stopMarks()

        assertEquals(RideMarks(listOf(PASSED, PASSED)), marks[0])
        assertEquals(RideMarks(listOf(PASSED, HERE, UPCOMING, UPCOMING)), marks[2])
    }

    @Test
    fun `between stops, the marker goes under the one behind`() {
        assertEquals(RideMarks(listOf(PASSED, PASSED, UPCOMING, UPCOMING), betweenAfter = 1), on(2, 1.5).stopMarks()[2])
    }

    @Test
    fun `nearly at the next stop counts as there`() {
        assertEquals(RideMarks(listOf(PASSED, PASSED, HERE, UPCOMING)), on(2, 1.9).stopMarks()[2])
    }

    @Test
    fun `waiting to board, the boarding stop is here only when a fix says so`() {
        val waiting = ActiveTrip(plan, start, origin)
        assertEquals(RideMarks(listOf(UPCOMING, UPCOMING)), waiting.stopMarks()[0])

        val seen = ActiveTrip(plan, start.copy(source = PositionSource.CONFIRMED), origin)
        assertEquals(RideMarks(listOf(HERE, UPCOMING)), seen.stopMarks()[0])
    }

    @Test
    fun `with no way to place the rider, nothing is claimed past what was seen`() {
        assertEquals(RideMarks(listOf(PASSED, PASSED, UPCOMING, UPCOMING)), on(2, 2.0, PositionSource.UNKNOWN).stopMarks()[2])
    }

    @Test
    fun `arrived, the destination is here`() {
        val arrived = ActiveTrip(plan, start.copy(legIndex = 2, phase = TripPhase.ARRIVED), origin)
        assertEquals(RideMarks(listOf(PASSED, PASSED, PASSED, HERE)), arrived.stopMarks()[2])
    }
}
