package id.shiorilabs.commute.core.trip

import id.shiorilabs.commute.core.trip.Places.CAWANG
import id.shiorilabs.commute.core.trip.Places.DUREN_KALIBATA
import id.shiorilabs.commute.core.trip.Places.MANGGARAI
import id.shiorilabs.commute.core.trip.Places.PASAR_MINGGU
import id.shiorilabs.commute.core.trip.Places.PASAR_MINGGU_BARU
import id.shiorilabs.commute.core.trip.Places.TEBET
import org.junit.Assert.assertEquals
import org.junit.Test

class RideClockTest {

    private val stops = listOf(MANGGARAI, TEBET, CAWANG, DUREN_KALIBATA, PASAR_MINGGU_BARU, PASAR_MINGGU)

    /** Manggarai 08.00 to Pasar Minggu 08.20, each stop timed at [minutes] (`null` for none). */
    private fun timed(vararg minutes: Int?, places: List<TripStop> = stops) = TripLeg.Ride(
        line = "KCI:B",
        operator = "KCI",
        stops = places.mapIndexed { i, stop -> stop.copy(scheduledAt = minutes[i]?.let(::at)) },
        departureAt = at(0),
        arrivalAt = at(20),
    )

    @Test
    fun `stop times place the train, uneven hops and all`() {
        val clock = RideClock(timed(0, 3, 5, 7, 8, 20))

        assertEquals(at(3), clock.scheduledAt(1.0))
        assertEquals(at(8), clock.scheduledAt(4.0))
        assertEquals(3.5, clock.positionAt(at(7.5))!!, 1e-9)
        // The long last hop: twelve minutes, so a minute in is barely past Pasar Minggu Baru.
        assertEquals(4.0 + 1.0 / 12, clock.positionAt(at(9))!!, 1e-9)
    }

    @Test
    fun `a stop with no time is placed between the timed ones around it`() {
        val unplaced = stops.map { it.copy(latitude = null, longitude = null) }
        val clock = RideClock(timed(0, 3, null, 7, 8, 20, places = unplaced))

        // By stop count, Cawang is halfway between Tebet's 08.03 and Duren Kalibata's 08.07.
        assertEquals(at(5), clock.scheduledAt(2.0))
    }

    @Test
    fun `two stops timed alike are passed in one go`() {
        val clock = RideClock(timed(0, 3, 3, 7, 8, 20))

        assertEquals(2.0, clock.positionAt(at(3))!!, 1e-9)
        assertEquals(2.5, clock.positionAt(at(5))!!, 1e-9)
    }

    @Test
    fun `times that run backwards fall back to the spread between the ends`() {
        val spread = RideClock(timed(0, null, null, null, null, 20))
        val slipped = RideClock(timed(0, 10, 5, 7, 8, 20))

        (0..5).forEach { assertEquals(spread.scheduledAt(it.toDouble()), slipped.scheduledAt(it.toDouble())) }
    }

    @Test
    fun `a time outside the ride's own ends is ignored`() {
        val clock = RideClock(timed(0, 3, 25, 7, 8, 20))

        assertEquals(clock.scheduledAt(2.0), RideClock(timed(0, 3, null, 7, 8, 20)).scheduledAt(2.0))
    }
}
