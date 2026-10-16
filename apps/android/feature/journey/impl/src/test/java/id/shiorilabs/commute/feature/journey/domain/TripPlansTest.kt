package id.shiorilabs.commute.feature.journey.domain

import id.shiorilabs.commute.core.navigation.Route
import id.shiorilabs.commute.core.trip.TripLeg
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
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
    fun `haltes several routes serve keep every route, and say which way only when they agree`() {
        // Setiabudi Integritas to Karet Kuningan on 2026-10-06: planned on 4D, ridden on an L13E.
        val leg = ride("TJ:4D", "TJ-H00215P", "TJ-H00098P").copy(
            headsign = "Kuningan",
            serviceLines = listOf(
                ServiceLine("TJ:4D", "Kuningan"),
                ServiceLine("TJ:6", "Ragunan"),
                ServiceLine("TJ:L13E", "Kuningan"),
            ),
        )
        val ride = journey(leg).toTripPlan().ride(0)

        assertEquals(listOf("TJ:4D", "TJ:6", "TJ:L13E"), ride.lineKeys)
        assertEquals(2, ride.otherLines)
        assertNull(ride.sharedHeadsign)
        assertEquals("Kuningan", ride.copy(serviceLines = ride.serviceLines.filter { it.line != "TJ:6" }).sharedHeadsign)
    }

    @Test
    fun `a ride only its own line runs keeps no list`() {
        val ride = timed.toTripPlan().ride(0)

        assertEquals(emptyList<Any>(), ride.serviceLines)
        assertEquals(0, ride.otherLines)
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
    fun `the plan keeps the later trains of a ride, not the one followed`() {
        fun train(id: String, minutes: Long) = LegDeparture(departs.plusSeconds(minutes * 60), departs.plusSeconds(minutes * 60 + 180), id, "KCI:B")
        val leg = ride("KCI:B", "KCI-MRI", "KCI-TEB", departureAt = departs, arrivalAt = departs.plusSeconds(180)).copy(
            tripId = "a1",
            upcomingDepartures = listOf(train("a1", 0), train("a2", 8), train("a3", 16), train("a4", 24), train("a5", 32), train("a6", 40)),
        )
        val ride = journey(leg).toTripPlan().ride(0)

        assertEquals(listOf(8L, 16L, 24L, 32L).map { departs.plusSeconds(it * 60) }, ride.nextDepartures)
    }

    @Test
    fun `an untimed ride keeps no later trains`() {
        assertEquals(emptyList<Instant>(), timed.toTripPlan().ride(2).nextDepartures)
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
    fun `forced, a journey can start hours before its train`() {
        assertEquals(TripStart.Ready, tripStartFor(timed, route, null, departs.minusSeconds(4 * 60 * 60), force = true))
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
