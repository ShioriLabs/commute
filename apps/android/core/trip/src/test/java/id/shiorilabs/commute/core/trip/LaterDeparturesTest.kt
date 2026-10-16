package id.shiorilabs.commute.core.trip

import org.junit.Assert.assertEquals
import org.junit.Test

class LaterDeparturesTest {

    private val ride = TripLeg.Ride(
        line = "KCI:B",
        operator = "KCI",
        stops = listOf(Places.MANGGARAI, Places.TEBET),
        departureAt = at(10),
        arrivalAt = at(14),
        nextDepartures = listOf(at(18), at(26), at(34)),
    )

    @Test
    fun `waiting for a train, what comes after it`() {
        assertEquals(listOf(at(18), at(26), at(34)), Headline.Board(ride, at(10)).laterDepartures(at(5)))
    }

    @Test
    fun `a change names them too`() {
        assertEquals(listOf(at(18), at(26), at(34)), Headline.Change(ride, null, at(10)).laterDepartures(at(5)))
    }

    @Test
    fun `trains that have gone are dropped as the clock moves on`() {
        assertEquals(listOf(at(26), at(34)), Headline.Board(ride, at(10)).laterDepartures(at(20)))
        assertEquals(emptyList<java.time.Instant>(), Headline.Board(ride, at(10)).laterDepartures(at(40)))
    }

    @Test
    fun `a late train pushes past the ones it would overlap`() {
        // Expected at 20 with lateness: the 18 is not a later train than the one being waited for.
        assertEquals(listOf(at(26), at(34)), Headline.Board(ride, at(20)).laterDepartures(at(5)))
    }

    @Test
    fun `riding or arrived has no later trains`() {
        assertEquals(emptyList<java.time.Instant>(), Headline.RideTo(ride, 1, at(14)).laterDepartures(at(5)))
        assertEquals(emptyList<java.time.Instant>(), Headline.Arrived("Tebet").laterDepartures(at(5)))
    }

    @Test
    fun `the watch and the phone pick by one rule`() {
        val times = listOf(at(18), at(26), at(34))

        assertEquals(listOf(at(26), at(34)), times.laterThan(at(20), at(5)))
        // The clock past the train waited for outranks it.
        assertEquals(listOf(at(34)), times.laterThan(at(10), at(30)))
        // No expected departure: the clock alone.
        assertEquals(listOf(at(26), at(34)), times.laterThan(null, at(20)))
    }
}
