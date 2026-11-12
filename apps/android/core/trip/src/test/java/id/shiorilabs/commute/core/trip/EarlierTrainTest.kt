package id.shiorilabs.commute.core.trip

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.time.Instant
import java.time.OffsetDateTime

class EarlierTrainTest {

    private fun wib(date: String, time: String): Instant = OffsetDateTime.parse("${date}T$time+07:00").toInstant()

    private fun train(id: String, departs: Double, arrives: Double? = null, headsign: String? = null, connectBy: Double? = null) =
        TripDeparture(at(departs), arrives?.let(::at), id, headsign, connectBy?.let(::at))

    @Test
    fun `30 Oct at Cakung, out at 09·25·20 for the 09·30, was the 09·22 to Angke`() {
        val day = "2026-10-30"
        val plan = TripPlan(
            listOf(
                TripLeg.Ride(
                    line = "KCI:C", operator = "KCI", headsign = "Kampung Bandan",
                    stops = listOf(Places.MANGGARAI, Places.SUDIRMAN),
                    departureAt = wib(day, "09:30:00"), arrivalAt = wib(day, "10:04:00"), tripId = "5073C",
                    nextDepartures = listOf(wib(day, "09:38:00")),
                    earlierDepartures = listOf(TripDeparture(wib(day, "09:22:00"), wib(day, "09:56:00"), "5071C", "Angke")),
                ),
            ),
        )

        val ride = plan.ontoEarlierTrain(0, wib(day, "09:25:20"))!!.ride(0)

        assertEquals("5071C", ride.tripId)
        assertEquals("Angke", ride.headsign)
        assertEquals(wib(day, "09:22:00"), ride.departureAt)
        assertEquals(wib(day, "09:56:00"), ride.arrivalAt)
        assertEquals(listOf(wib(day, "09:30:00"), wib(day, "09:38:00")), ride.nextDepartures)
        assertEquals(emptyList<TripDeparture>(), ride.earlierDepartures)
        assertEquals("KCI:C", ride.line)
    }

    @Test
    fun `5 Nov on the Cakung platform, out at 09·39·50 for the 09·45, was the 09·35 past the clock's floor`() {
        // −310 s against the 09.45: the engine's −300 floor made the two trains a tie, and the tie kept the 09.45.
        val day = "2026-11-05"
        val plan = TripPlan(
            listOf(
                TripLeg.Ride(
                    line = "KCI:C", operator = "KCI", headsign = "Kampung Bandan",
                    stops = listOf(Places.MANGGARAI, Places.SUDIRMAN),
                    departureAt = wib(day, "09:45:00"), arrivalAt = wib(day, "10:05:00"), tripId = "5077C",
                    earlierDepartures = listOf(TripDeparture(wib(day, "09:35:00"), wib(day, "09:55:00"), "5075C")),
                ),
            ),
        )

        val ride = plan.ontoEarlierTrain(0, wib(day, "09:39:50"))!!.ride(0)

        assertEquals("5075C", ride.tripId)
        // No headsign named for the train: the plan's stands.
        assertEquals("Kampung Bandan", ride.headsign)
        assertEquals(wib(day, "09:55:00"), ride.arrivalAt)
    }

    private val single = TripPlan(
        listOf(
            ride(Places.MANGGARAI, Places.TEBET, Places.CAWANG, departs = 0, arrives = 6).copy(
                earlierDepartures = listOf(train("e2", -8.0, -2.0), train("e1", -4.0, 2.0)),
            ),
        ),
    )

    @Test
    fun `out less than two minutes before the plan's train is that train`() {
        assertNull(single.ontoEarlierTrain(0, at(-1.5)))
    }

    @Test
    fun `out before any listed train was due is none of them`() {
        assertNull(single.ontoEarlierTrain(0, at(-9.0)))
    }

    @Test
    fun `of the trains due by then, the least late`() {
        val ride = single.ontoEarlierTrain(0, at(-3.0))!!.ride(0)

        assertEquals("e1", ride.tripId)
        assertEquals(listOf("e2"), ride.earlierDepartures.map { it.tripId })
        assertEquals(listOf(at(0)), ride.nextDepartures)
    }

    @Test
    fun `a train is read as due a little after the fix put it out`() {
        // Projection wobble: the e1 seen out 20 s "before" its time.
        assertEquals("e1", single.ontoEarlierTrain(0, at(-4.0).minusSeconds(20))!!.ride(0).tripId)
    }

    @Test
    fun `with no arrival named the train's times shift with it`() {
        val plan = TripPlan(listOf(ride(Places.MANGGARAI, Places.TEBET, departs = 0, arrives = 6).copy(
            stops = listOf(Places.MANGGARAI.copy(scheduledAt = at(0)), Places.TEBET.copy(scheduledAt = at(6))),
            earlierDepartures = listOf(train("e1", -5.0)),
        )))

        val ride = plan.ontoEarlierTrain(0, at(-4.0))!!.ride(0)

        assertEquals(at(1), ride.arrivalAt)
        assertEquals(listOf(at(-5), at(1)), ride.stops.map { it.scheduledAt })
    }

    @Test
    fun `without earlier trains nothing moves`() {
        assertNull(bogorLine.ontoEarlierTrain(0, at(-5.0)))
    }

    /** MRT to Dukuh Atas, 300 m to Sudirman, the Commuter Line on, with a three-minute allowance. */
    private fun changing(vararg onward: TripDeparture, minChangeS: Int? = 180) = TripPlan(
        listOf(
            ride(Places.BUNDARAN_HI, Places.DUKUH_ATAS, line = "MRTJ:M", departs = 0, arrives = 2)
                .copy(earlierDepartures = listOf(train("m0", -4.0, -2.0))),
            TripLeg.Transfer(Places.DUKUH_ATAS, Places.SUDIRMAN, distanceM = 300),
            ride(Places.SUDIRMAN, Places.MANGGARAI, line = "KCI:B", departs = 10, arrives = 15)
                .copy(earlierDepartures = onward.toList(), minChangeS = minChangeS),
        ),
    )

    @Test
    fun `the next ride moves onto the first of its trains the earlier arrival makes`() {
        // In at 07.58 with three minutes to change: the 08.00 is gone by then, the 08.04 not.
        val plan = changing(train("k0", 0.0), train("k1", 4.0, 9.0), train("k2", 7.0)).ontoEarlierTrain(0, at(-3.5))!!

        val onward = plan.ride(2)
        assertEquals("k1", onward.tripId)
        assertEquals(at(4), onward.departureAt)
        assertEquals(at(9), onward.arrivalAt)
        assertEquals(listOf(at(7), at(10)), onward.nextDepartures)
    }

    @Test
    fun `behind a level crossing the cutoff decides, not the walk`() {
        // The walk would make the 08.04, but the crossing shuts for it before the 07.58 arrival gets there.
        val plan = changing(train("k1", 4.0, connectBy = -3.0), train("k2", 7.0, connectBy = 1.0)).ontoEarlierTrain(0, at(-3.5))!!

        assertEquals("k2", plan.ride(2).tripId)
    }

    @Test
    fun `a change the earlier arrival can't better leaves the next ride as planned`() {
        val plan = changing(train("k0", 0.0)).ontoEarlierTrain(0, at(-3.5))!!

        assertEquals("m0", plan.ride(0).tripId)
        assertEquals(at(10), plan.ride(2).departureAt)
    }

    @Test
    fun `with no allowance named, a minute plus the walk at average pace`() {
        // 300 m at 1.2 m/s is 250 s: in at 07.58, the 08.02 is out of reach and the 08.03 not.
        val plan = changing(train("k1", 2.0), train("k2", 3.0), minChangeS = null).ontoEarlierTrain(0, at(-3.5))!!

        assertEquals("k2", plan.ride(2).tripId)
    }

    @Test
    fun `the moves run on through every change, and stop at a ride with no timetable`() {
        val plan = TripPlan(
            listOf(
                ride(Places.MANGGARAI, Places.TEBET, departs = 0, arrives = 4).copy(earlierDepartures = listOf(train("a0", -5.0, -1.0))),
                ride(Places.TEBET, Places.CAWANG, departs = 6, arrives = 9).copy(earlierDepartures = listOf(train("b0", 1.0, 4.0)), minChangeS = 60),
                ride(Places.CAWANG, Places.DUREN_KALIBATA, departs = 11, arrives = 14).copy(earlierDepartures = listOf(train("c0", 6.0, 9.0)), minChangeS = 60),
                ride(Places.DUREN_KALIBATA, Places.PASAR_MINGGU),
            ),
        )

        val moved = plan.ontoEarlierTrain(0, at(-4.0))!!

        assertEquals(listOf("a0", "b0", "c0", null), moved.rideIndices.map { moved.ride(it).tripId })
        assertNull(moved.ride(3).departureAt)
    }

    @Test
    fun `the departure is read off the fix without the engine's five-minute floor`() {
        val ride = bogorLine.ride(0)
        val dueAtTebet = RideClock(ride).scheduledAt(1.0)!!

        assertEquals(at(-7), ride.leftAt(1.0, dueAtTebet.minusSeconds(7 * 60)))
        assertNull(busway.ride(0).leftAt(1.0, at(0)))
    }
}
