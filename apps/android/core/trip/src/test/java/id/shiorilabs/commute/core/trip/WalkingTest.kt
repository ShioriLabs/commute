package id.shiorilabs.commute.core.trip

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class WalkingTest {

    private val walking = TripEngine.start(krlThenLrt, at(0), hasLocation = true).state.copy(
        legIndex = 2,
        phase = TripPhase.WAITING_TO_BOARD,
        walkingSince = at(4),
    )

    @Test
    fun `a walk takes the stairs and corridors on top of the distance`() {
        // 310 m is 4 minutes 42 at an easy pace; the 19 Oct walk from Sudirman to Dukuh Atas BSI took about 9.
        val ends = walking.walkEndsAt(krlThenLrt)!!

        assertEquals(4 * 60L + 281 + 180, ends.epochSecond - at(0).epochSecond)
    }

    @Test
    fun `a short change gets a share of the overhead, not all of it`() {
        val platformChange = TripPlan(
            listOf(
                krlThenLrt.legs[0],
                TripLeg.Transfer(Places.SUDIRMAN, Places.LRT_DUKUH_ATAS, distanceM = 50),
                krlThenLrt.legs[2],
            ),
        )
        val ends = walking.walkEndsAt(platformChange)!!

        // 45 s at an easy pace, and 60 s of stairs: 50 m is not 310.
        assertEquals(45L + 60, ends.epochSecond - at(4).epochSecond)
    }

    @Test
    fun `riding on, the next ride's ready time counts the same walk`() {
        val aboard = walking.copy(legIndex = 0, phase = TripPhase.RIDING, walkingSince = null, confirmedAt = at(2))

        val (next, readyAt) = aboard.nextRideReadyAt(krlThenLrt)!!

        assertEquals(2, next)
        assertEquals(aboard.expectedAlightingAt(krlThenLrt)!!.plusSeconds(281 + 180), readyAt)
    }

    @Test
    fun `a ride moved onto a later train keeps the arrival the change was planned for`() {
        // The 08.00 to 08.04, moved to the 08.04 to 08.08: the change at 310 m was allowed for from 08.04.
        val ride = krlThenLrt.legs[0] as TripLeg.Ride
        val moved = TripPlan(
            listOf(
                ride.copy(departureAt = at(4), arrivalAt = at(8), plannedArrivalAt = ride.arrivalAt),
                krlThenLrt.legs[1],
                krlThenLrt.legs[2],
            ),
        )

        assertEquals(at(4).plusSeconds(281 + 180), moved.plannedReadyAt(2))
    }

    @Test
    fun `no walk before the ride, none to end`() {
        val noWalk = TripEngine.start(bogorLine, at(0), hasLocation = true).state.copy(walkingSince = at(1))

        assertNull(noWalk.walkEndsAt(bogorLine))
    }
}
