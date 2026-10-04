package id.shiorilabs.commute.feature.journey.domain

import id.shiorilabs.commute.core.navigation.Route
import id.shiorilabs.commute.core.trip.TripLeg
import org.junit.Assert.assertEquals
import org.junit.Test
import java.time.Instant

class TripPlansTest {

    private val departs = Instant.parse("2026-10-04T01:00:00Z")

    private val timed = journey(
        ride("MRTJ:M", "MRTJ-BHI", "MRTJ-DKA", departureAt = departs, arrivalAt = departs.plusSeconds(120)),
        walk("MRTJ-DKA", "KCI-SUD", distanceM = 300, corridorLabel = "Terowongan"),
        ride("KCI:B", "KCI-SUD", "KCI-MRI"),
    )

    private val route = Route.Trip(fromId = "MRTJ-BHI", toId = "KCI-MRI", journeyKey = "k", boardingClock = "0800")

    @Test
    fun `a journey becomes a plan leg for leg`() {
        val plan = timed.toTripPlan()

        assertEquals(3, plan.legs.size)
        val first = plan.legs[0] as TripLeg.Ride
        assertEquals("MRTJ:M", first.line)
        assertEquals(listOf("MRTJ-BHI", "MRTJ-DKA"), first.stops.map { it.id })
        assertEquals(departs, first.departureAt)
        val walk = plan.legs[1] as TripLeg.Transfer
        assertEquals(300, walk.distanceM)
        assertEquals("Terowongan", walk.corridorLabel)
        assertEquals(null, (plan.legs[2] as TripLeg.Ride).departureAt)
    }

    @Test
    fun `the plan keeps each stop's place and time, and the run boarded`() {
        val leg = ride("KCI:B", "KCI-MRI", "KCI-TEB", departureAt = departs, arrivalAt = departs.plusSeconds(180)).copy(
            stops = listOf(JourneyStop("KCI-MRI", "Manggarai", -6.21, 106.8498), JourneyStop("KCI-TEB", "Tebet", -6.2262, 106.8584)),
            stopTimes = listOf(departs, departs.plusSeconds(180)),
            tripId = "1466",
        )
        val ride = journey(leg).toTripPlan().ride(0)

        assertEquals(-6.2262, ride.stops[1].latitude!!, 1e-9)
        assertEquals(listOf(departs, departs.plusSeconds(180)), ride.stops.map { it.scheduledAt })
        assertEquals("1466", ride.tripId)
    }

    @Test
    fun `a leg without stop times leaves its stops untimed`() {
        val ride = timed.toTripPlan().ride(0)

        assertEquals(listOf(null, null), ride.stops.map { it.scheduledAt })
        assertEquals(null, ride.tripId)
    }

    @Test
    fun `a trip can start half an hour before boarding, not earlier`() {
        assertEquals(TripStart.Ready, tripStartFor(timed, route, null, departs.minusSeconds(30 * 60)))
        assertEquals(TripStart.TooEarly(departs), tripStartFor(timed, route, null, departs.minusSeconds(31 * 60)))
        assertEquals(TripStart.Ready, tripStartFor(timed, route, null, departs.plusSeconds(600)))
    }

    @Test
    fun `an untimed journey can start whenever`() {
        val untimed = journey(ride("TJ:1", "TJ-H1", "TJ-H4"))
        assertEquals(TripStart.Ready, tripStartFor(untimed, route, null, departs.minusSeconds(5 * 3600)))
    }

    @Test
    fun `the running trip is this journey only on the same pair, route and boarding`() {
        assertEquals(TripStart.Running, tripStartFor(timed, route, route.copy(at = "2026-10-04T08:00"), departs))
        assertEquals(TripStart.Ready, tripStartFor(timed, route, route.copy(boardingClock = "0811"), departs))
    }
}
