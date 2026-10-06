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
    fun `nearly at the next stop is still on the way to it, as the board says`() {
        // Buaran to Klender on 2026-10-06: "Kamu di sini" at Klender 400 m out, under "Berikutnya".
        assertEquals(RideMarks(listOf(PASSED, PASSED, UPCOMING, UPCOMING), betweenAfter = 1), on(2, 1.9).stopMarks()[2])
    }

    @Test
    fun `the clock passes through a stop, it doesn't stop there`() {
        assertEquals(
            RideMarks(listOf(PASSED, PASSED, UPCOMING, UPCOMING), betweenAfter = 1),
            on(2, 1.0, PositionSource.ESTIMATED).stopMarks()[2],
        )
    }

    @Test
    fun `at the stop to get off at, it is here however the trip knows`() {
        assertEquals(RideMarks(listOf(PASSED, PASSED, PASSED, HERE)), on(2, 3.0, PositionSource.ESTIMATED).stopMarks()[2])
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

    @Test
    fun `a short ride shows every stop`() {
        assertEquals((0..6).map(TimelineRow::Stop), timelineRows(7, focus = 3, expanded = false))
    }

    @Test
    fun `a long ride keeps its ends, the stops round the rider and the one before getting off`() {
        // Manggarai to Depok, thirteen stops, the rider making for Cawang.
        val rows = timelineRows(13, focus = 2, expanded = false)

        assertEquals(
            listOf(
                TimelineRow.Stop(0), TimelineRow.Stop(1), TimelineRow.Stop(2), TimelineRow.Stop(3), TimelineRow.Stop(4),
                TimelineRow.Folded(5, 10),
                TimelineRow.Stop(11), TimelineRow.Stop(12),
            ),
            rows,
        )
        assertEquals(6, (rows[5] as TimelineRow.Folded).count)
    }

    @Test
    fun `a lone stop between kept ones isn't folded`() {
        // Kept: 0, 4 to 7 round the rider at 5, 9 and 10; 8 alone stays a stop.
        val rows = timelineRows(11, focus = 5, expanded = false)

        assertEquals(listOf(TimelineRow.Stop(0), TimelineRow.Folded(1, 3)), rows.take(2))
        assertEquals(true, TimelineRow.Stop(8) in rows)
    }

    @Test
    fun `opened, a long ride shows every stop`() {
        assertEquals(13, timelineRows(13, focus = 2, expanded = true).size)
    }
}
