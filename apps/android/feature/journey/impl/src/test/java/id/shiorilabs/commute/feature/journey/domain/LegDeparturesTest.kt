package id.shiorilabs.commute.feature.journey.domain

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.OffsetDateTime

/** The web's `fare-sheet/leg-departures.test.ts`. */
class LegDeparturesTest {

    private fun at(hhmm: String) = OffsetDateTime.parse("2026-10-16T$hhmm:00+07:00").toInstant()

    private fun train(tripId: String, dep: String, arr: String) = LegDeparture(at(dep), at(arr), tripId, "KCI:BK")

    private fun timedRide(upcoming: List<LegDeparture>, minChangeS: Int? = null) = ride("KCI:BK", "A", "B").copy(
        departureAt = upcoming.first().departureAt,
        arrivalAt = upcoming.first().arrivalAt,
        tripId = upcoming.first().tripId,
        upcomingDepartures = upcoming,
        minChangeS = minChangeS,
    )

    // Depok to Manggarai, then Manggarai to Bekasi.
    private val first = listOf(train("a1", "07:12", "07:46"), train("a2", "07:20", "07:54"), train("a3", "07:28", "08:02"), train("a4", "07:36", "08:10"))
    private val second = listOf(train("b1", "07:52", "08:14"), train("b2", "08:00", "08:22"), train("b3", "08:10", "08:32"))
    private val legs: List<JourneyLeg> = listOf(timedRide(first), timedRide(second))

    @Test
    fun `the first train on every leg is chosen by default`() {
        assertEquals(listOf("a1", "b1"), resolveTimedLegs(legs, emptyMap()).map { it.chosen.tripId })
    }

    @Test
    fun `trains that have left are dropped, and the next one is boarded`() {
        // 07.22: a1 and a2 both left more than the minute's grace ago.
        val timed = resolveTimedLegs(legs, emptyMap(), notBefore = at("07:22"))

        assertEquals(listOf("a3", "a4"), timed[0].options.map { it.departure.tripId })
        assertEquals(listOf("a3", "b3"), timed.map { it.chosen.tripId })
    }

    @Test
    fun `a later leg drops its departed trains too`() {
        // 07.45: y1 left at 07.30, long before the train the rider boards first.
        val ahead = listOf(train("x1", "07:50", "08:00"))
        val onward = listOf(train("y1", "07:30", "07:40"), train("y2", "08:05", "08:25"))

        val timed = resolveTimedLegs(listOf(timedRide(ahead), timedRide(onward)), emptyMap(), notBefore = at("07:45"))

        assertEquals(listOf("y2"), timed[1].options.map { it.departure.tripId })
    }

    @Test
    fun `a row shows a later leg from the train just missed, at most a chip row`() {
        val many = listOf(
            train("c1", "07:40", "08:00"), train("c2", "07:50", "08:10"), train("c3", "08:00", "08:20"),
            train("c4", "08:05", "08:25"), train("c5", "08:10", "08:30"), train("c6", "08:15", "08:35"),
        )
        // a2 lands 07.54: c1 and c2 are missed, c3 is the first it makes.
        val second = resolveTimedLegs(listOf(timedRide(first), timedRide(many)), mapOf(0 to "a2"))[1]

        assertEquals(listOf("c2", "c3", "c4", "c5"), second.options.map { it.departure.tripId })
    }

    @Test
    fun `the row slides so a later pick stays in view`() {
        val many = listOf(
            train("c1", "07:50", "08:00"), train("c2", "07:55", "08:05"), train("c3", "08:00", "08:10"),
            train("c4", "08:05", "08:15"), train("c5", "08:10", "08:20"), train("c6", "08:15", "08:25"),
        )
        val second = resolveTimedLegs(listOf(timedRide(first), timedRide(many)), mapOf(1 to "c6"))[1]

        assertEquals(listOf("c3", "c4", "c5", "c6"), second.options.map { it.departure.tripId })
    }

    @Test
    fun `a train leaving this minute is still the one`() {
        assertEquals("a2", resolveTimedLegs(legs, emptyMap(), notBefore = at("07:20")).first().chosen.tripId)
    }

    @Test
    fun `a train that left within the last minute is still the one`() {
        assertEquals("a2", resolveTimedLegs(legs, emptyMap(), notBefore = at("07:20").plusSeconds(59)).first().chosen.tripId)
    }

    @Test
    fun `a train gone for more than a minute is passed over`() {
        assertEquals("a3", resolveTimedLegs(legs, emptyMap(), notBefore = at("07:20").plusSeconds(61)).first().chosen.tripId)
    }

    @Test
    fun `when every first train has gone the answer stands as it is`() {
        assertEquals(listOf("a1", "b1"), resolveTimedLegs(legs, emptyMap(), notBefore = at("09:00")).map { it.chosen.tripId })
    }

    @Test
    fun `the later leg moves when an earlier pick lands after its train`() {
        // a2 arrives 07.54, so b1 (07.52) is gone and b2 takes over.
        assertEquals(listOf("a2", "b2"), resolveTimedLegs(legs, mapOf(0 to "a2")).map { it.chosen.tripId })
    }

    @Test
    fun `trains that can no longer be reached are marked, not hidden`() {
        val options = resolveTimedLegs(legs, mapOf(0 to "a2"))[1].options

        assertEquals(listOf("b1" to Blocked.MISSED, "b2" to null, "b3" to null), options.map { it.departure.tripId to it.blocked })
    }

    @Test
    fun `a pick on a later leg leaves the earlier one alone`() {
        assertEquals(listOf("a1", "b3"), resolveTimedLegs(legs, mapOf(1 to "b3")).map { it.chosen.tripId })
    }

    @Test
    fun `a train nothing onward connects from cannot be picked`() {
        // a4 lands 08.10; b3 leaves 08.10 which is less than the minute's change.
        val options = resolveTimedLegs(legs, emptyMap())[0].options

        assertEquals(Blocked.NO_ONWARD, options.single { it.departure.tripId == "a4" }.blocked)
        assertEquals(listOf("a1", "b1"), resolveTimedLegs(legs, mapOf(0 to "a4")).map { it.chosen.tripId })
    }

    @Test
    fun `a connection with little to spare beyond the change is tight`() {
        val timed = listOf(timedRide(first), timedRide(second, minChangeS = 5 * 60))
        // a1 lands 07.46, b1 leaves 07.52: six minutes for a five minute change.
        val option = resolveTimedLegs(timed, emptyMap())[0].options.first()

        assertEquals(6L * 60, option.gapToNextS)
        assertTrue(option.tight)
    }

    @Test
    fun `the engine's change allowance beats the fallback`() {
        val timed = listOf(timedRide(first), timedRide(second, minChangeS = 10 * 60))
        // 07.46 + 10 min = 07.56, so b1 (07.52) is out of reach even for the earliest pick.
        assertEquals(listOf("a1", "b2"), resolveTimedLegs(timed, emptyMap()).map { it.chosen.tripId })
    }

    @Test
    fun `changeAt is the gap between the chosen trains`() {
        val timed = resolveTimedLegs(legs, emptyMap())
        val change = changeAt(legs, timed, 1)!!

        assertEquals(6L * 60, change.gapS)
        assertNull(changeAt(legs, timed, 0))
    }

    @Test
    fun `retimeJourney is the same object when nothing was picked`() {
        val journey = journey(*legs.toTypedArray())

        assertSame(journey, retimeJourney(journey, resolveTimedLegs(legs, emptyMap())))
    }

    @Test
    fun `retimeJourney moves every later leg and drops the route's other boardings`() {
        val base = journey(*legs.toTypedArray()).copy(arrivalAt = at("08:14"), moreDepartures = listOf(JourneyDeparture(at("07:20"))))
        val retimed = retimeJourney(base, resolveTimedLegs(legs, mapOf(0 to "a2")))
        val rides = retimed.legs.filterIsInstance<JourneyLeg.Ride>()

        assertEquals(listOf("a2", "b2"), rides.map { it.tripId })
        assertEquals(at("08:22"), retimed.arrivalAt)
        assertTrue(retimed.moreDepartures.isEmpty())
    }

    @Test
    fun `leaveInOf names the minutes and the edges`() {
        val now = at("07:08")

        assertEquals(LeaveIn.InMinutes(4), leaveInOf(at("07:12"), now))
        assertEquals(LeaveIn.Now, leaveInOf(at("07:08"), now))
        assertEquals(LeaveIn.Gone, leaveInOf(at("07:00"), now))
        assertNull(leaveInOf(at("09:00"), now))
    }

    @Test
    fun `liveDeparturesOf leads with the own train, then the later ones that have not left`() {
        val own = journey(timedRide(first.take(1))).copy(
            arrivalAt = at("07:46"),
            moreDepartures = listOf(JourneyDeparture(at("07:20"), at("07:54")), JourneyDeparture(at("07:28"))),
        )

        assertEquals(listOf(at("07:12"), at("07:20"), at("07:28")), liveDeparturesOf(own, at("07:10")).map { it.departureAt })
        assertEquals(listOf(at("07:20"), at("07:28")), liveDeparturesOf(own, at("07:15")).map { it.departureAt })
        assertEquals(emptyList<JourneyDeparture>(), liveDeparturesOf(own, at("08:00")))
    }

    private fun walkLeg(distanceM: Int) = walk("B", "B2", distanceM = distanceM)

    @Test
    fun `a change is at least a minute even with no walk leg`() {
        // a4 arrives 08.10 and b3 leaves 08.10: a zero-second change is not a change.
        val options = resolveTimedLegs(legs, emptyMap())[0].options

        assertNull(options[3].gapToNextS)
        assertEquals(Blocked.NO_ONWARD, options[3].blocked)
    }

    @Test
    fun `the gap to the next boarding is reported for each option`() {
        assertEquals(listOf<Long?>(360, 360, 480, null), resolveTimedLegs(legs, emptyMap())[0].options.map { it.gapToNextS })
    }

    @Test
    fun `a pick that no longer connects is ignored`() {
        // b1 is picked but a3 arrives at 08.02, after it left.
        assertEquals(listOf("a3", "b3"), resolveTimedLegs(legs, mapOf(0 to "a3", 1 to "b1")).map { it.chosen.tripId })
    }

    @Test
    fun `the transfer walk is charged at average pace without an allowance`() {
        // 600 m at 1.2 m/s is 500 s, so a 07.46 arrival cannot make a 07.52 train.
        val withWalk = listOf(timedRide(first), walkLeg(600), timedRide(second))

        assertEquals("b2", resolveTimedLegs(withWalk, emptyMap())[1].chosen.tripId)
    }

    @Test
    fun `an untimed journey has no timed legs`() {
        assertEquals(emptyList<TimedLeg>(), resolveTimedLegs(listOf(ride("KCI:BK", "A", "B")), emptyMap()))
    }

    @Test
    fun `nothing is retimed when no train can finish the journey`() {
        val late = listOf(timedRide(listOf(train("a1", "09:00", "09:30"))), timedRide(listOf(train("b1", "07:00", "07:20"))))

        assertEquals(emptyList<TimedLeg>(), resolveTimedLegs(late, emptyMap()))
    }

    @Test
    fun `the engine's allowance is trusted over the fallback, and tight is judged beyond it`() {
        // 600 m between the rides: the fallback would demand 500 s; the engine allows 300 s.
        val withAllowance = listOf(timedRide(first), walkLeg(600), timedRide(second, minChangeS = 300))
        val options = resolveTimedLegs(withAllowance, emptyMap())

        assertEquals("b1", options[1].chosen.tripId)
        assertNull(options[1].options[0].blocked)
        // a1 to b1 is a 360 s gap: 60 s to spare, so tight. a3 to b3 is 480 s: 180 s to spare.
        assertEquals(360L, options[0].options[0].gapToNextS)
        assertTrue(options[0].options[0].tight)
        assertEquals(480L, options[0].options[2].gapToNextS)
        assertEquals(false, options[0].options[2].tight)
        assertEquals(Change(360, true), changeAt(withAllowance, options, 1))
    }

    @Test
    fun `a train is checked against the legs after the next one too`() {
        // c only runs early: b3 cannot finish, so neither can a3, which only connects to b3.
        val third = listOf(train("c1", "08:20", "08:30"), train("c2", "08:30", "08:40"))
        val timed = resolveTimedLegs(listOf(timedRide(first), timedRide(second), timedRide(third)), emptyMap())

        assertEquals(listOf<Blocked?>(null, null, Blocked.NO_ONWARD), timed[1].options.map { it.blocked })
        assertEquals(listOf<Blocked?>(null, null, Blocked.NO_ONWARD, Blocked.NO_ONWARD), timed[0].options.map { it.blocked })
    }

    @Test
    fun `a retimed leg drops what only the caught train knew, and the input is not mutated`() {
        val caught = (legs[0] as JourneyLeg.Ride).copy(stopTimes = listOf(at("07:12")), lastService = true)
        val base = journey(caught, legs[1]).copy(arrivalAt = at("08:14"))
        val view = retimeJourney(base, resolveTimedLegs(base.legs, mapOf(0 to "a2")))
        val retimed = view.legs[0] as JourneyLeg.Ride

        assertEquals("a2", retimed.tripId)
        assertEquals(at("07:20"), retimed.departureAt)
        assertTrue(retimed.stopTimes.isEmpty())
        assertEquals(false, retimed.lastService)
        assertEquals(at("08:14"), base.arrivalAt)
        assertEquals(true, (base.legs[0] as JourneyLeg.Ride).lastService)
    }
}
