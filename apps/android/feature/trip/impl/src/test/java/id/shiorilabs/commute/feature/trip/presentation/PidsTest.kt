package id.shiorilabs.commute.feature.trip.presentation

import id.shiorilabs.commute.core.trip.PositionSource
import id.shiorilabs.commute.core.trip.TripEngine
import id.shiorilabs.commute.core.trip.TripPhase
import id.shiorilabs.commute.feature.trip.ActiveTrip
import id.shiorilabs.commute.feature.trip.NOW
import id.shiorilabs.commute.feature.trip.minutes
import id.shiorilabs.commute.feature.trip.origin
import id.shiorilabs.commute.feature.trip.plan
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class PidsTest {

    /** Two minutes before the first train. */
    private val start = TripEngine.start(plan, NOW.minusSeconds(120), hasLocation = true).state

    private fun riding(position: Double, source: PositionSource = PositionSource.ESTIMATED) = ActiveTrip(
        plan,
        start.copy(legIndex = 2, phase = TripPhase.RIDING, position = position, confirmedPosition = position, source = source),
        origin,
    )

    @Test
    fun `riding, the board names the next stop and counts down the ones after`() {
        // Sudirman → Manggarai → Tebet → Cawang, 08.10 to 08.20, a little past Sudirman at 08.11.
        val pids = riding(0.3).pids(minutes(11))

        assertEquals(PidsLabel.NEXT, pids.label)
        assertEquals("Manggarai", pids.station)
        assertEquals(listOf("Manggarai", "Tebet", "Cawang"), pids.upcoming.map { it.name })
        assertEquals(listOf(true, false, false), pids.upcoming.map { it.next })
        assertEquals(listOf(false, false, true), pids.upcoming.map { it.alighting })
        assertEquals(true, pids.upcoming.all { it.minutes != null })
        assertNull(pids.changeTo)
        assertEquals(3, pids.stopsLeft)
        // Minutes to getting off at Cawang, not to Manggarai.
        assertEquals(pids.upcoming.last().minutes, pids.minutesLeft)
        assertEquals(true, pids.minutesLeft!! > pids.upcoming.first().minutes!!)
        assertEquals(true, pids.alightingAt!! > pids.at!!)
    }

    @Test
    fun `the stop before getting off says so`() {
        assertEquals(PidsLabel.ALIGHT_NEXT, riding(2.4).pids(minutes(16)).label)
    }

    @Test
    fun `nothing placing the rider leaves the bubbles blank`() {
        assertEquals(true, riding(1.0, PositionSource.UNKNOWN).pids(minutes(14)).upcoming.all { it.minutes == null })
    }

    @Test
    fun `at the end of a ride with another to come, the board says what to change to`() {
        val atDukuhAtas = ActiveTrip(plan, start.copy(phase = TripPhase.RIDING, position = 1.0), origin)
        val pids = atDukuhAtas.pids(minutes(2))

        assertEquals(PidsLabel.ALIGHT_HERE, pids.label)
        assertEquals("Dukuh Atas BNI", pids.station)
        assertEquals(plan.ride(2), pids.changeTo)
    }

    @Test
    fun `waiting, the board names where to board`() {
        val pids = ActiveTrip(plan, start, origin).pids(NOW.minusSeconds(60))

        assertEquals(PidsLabel.BOARD, pids.label)
        assertEquals("Bundaran HI", pids.station)
        assertEquals(minutes(0), pids.at)
    }

    @Test
    fun `a train still not left after its time counts down from now, not from the timetable`() {
        // Still at Sudirman, confirmed, five minutes after the 08.10 was due out.
        val held = riding(0.0, PositionSource.CONFIRMED).pids(minutes(15))

        val minutes = held.upcoming.map { it.minutes!! }
        // Manggarai is a third of the ride: about three of its ten minutes on from wherever "now" is.
        assertEquals(true, minutes.first() >= 2)
        assertEquals(minutes.sorted(), minutes)
        assertEquals(true, held.at!! > minutes(15))
    }
}


