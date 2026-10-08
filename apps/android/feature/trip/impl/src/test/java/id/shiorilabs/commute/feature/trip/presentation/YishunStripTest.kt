package id.shiorilabs.commute.feature.trip.presentation

import id.shiorilabs.commute.core.trip.PositionSource
import id.shiorilabs.commute.core.trip.TripEngine
import id.shiorilabs.commute.core.trip.TripLeg
import id.shiorilabs.commute.core.trip.TripPhase
import id.shiorilabs.commute.core.trip.TripPlan
import id.shiorilabs.commute.core.trip.TripStop
import id.shiorilabs.commute.feature.trip.ActiveTrip
import id.shiorilabs.commute.feature.trip.NOW
import id.shiorilabs.commute.feature.trip.minutes
import id.shiorilabs.commute.feature.trip.origin
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class YishunStripTest {

    /** Bogor to Jakarta Kota, 26 stops a couple of minutes apart, 08.00 to 08.58. */
    private val bogorLine = (0 until 26).map { TripStop("KCI-$it", "Stop $it", -6.6 + it * 0.02, 106.8) }

    private fun ride(stops: List<TripStop>, line: String = "KCI:B", timed: Boolean = true) = TripPlan(
        listOf(
            TripLeg.Ride(
                line = line,
                operator = line.substringBefore(':'),
                headsign = "Jakarta Kota",
                platformCode = null,
                stops = stops,
                departureAt = if (timed) minutes(0) else null,
                arrivalAt = if (timed) minutes(58) else null,
            ),
        ),
    )

    private fun trip(plan: TripPlan, phase: TripPhase, position: Double, source: PositionSource = PositionSource.ESTIMATED): ActiveTrip {
        val start = TripEngine.start(plan, NOW.minusSeconds(120), hasLocation = true).state
        return ActiveTrip(plan, start.copy(phase = phase, position = position, confirmedPosition = position, source = source), origin)
    }

    private fun strip(trip: ActiveTrip, at: Long) = trip.yishunStrip(trip.pids(minutes(at)), minutes(at))

    @Test
    fun `boarding a long ride, the strip shows the next few and the last stop, nothing between`() {
        val strip = strip(trip(ride(bogorLine), TripPhase.WAITING_TO_BOARD, 0.0), at = 0)!!

        assertEquals(listOf(0, 1, 2, 3, 25), strip.stops.map { it.index })
        assertEquals(21, strip.skipped)
        assertTrue(strip.stops.none { it.passed })
        assertEquals(listOf(true, false, false, false, false), strip.stops.map { it.focus })
        assertEquals(listOf(false, false, false, false, true), strip.stops.map { it.last })
    }

    @Test
    fun `mid-ride, two behind are greyed, then the next and three ahead, then the last`() {
        // Past stop 9, so stop 10 is next.
        val strip = strip(trip(ride(bogorLine), TripPhase.RIDING, 9.4), at = 22)!!

        assertEquals(listOf(8, 9, 10, 11, 12, 13, 25), strip.stops.map { it.index })
        assertEquals(listOf(true, true, false, false, false, false, false), strip.stops.map { it.passed })
        assertEquals(10, strip.stops.single { it.focus }.index)
        assertEquals(11, strip.skipped)
        // Behind has no minutes; ahead does, the last stop included.
        assertTrue(strip.stops.filter { it.passed }.all { it.minutes == null })
        assertTrue(strip.stops.filter { !it.passed }.all { it.minutes != null })
    }

    @Test
    fun `near the end, the strip runs on to the last stop with no gap`() {
        // Stop 21 next: 22, 23, 24 and the last, 25, all fit.
        val strip = strip(trip(ride(bogorLine), TripPhase.RIDING, 20.5), at = 48)!!

        assertEquals(listOf(19, 20, 21, 22, 23, 24, 25), strip.stops.map { it.index })
        assertEquals(0, strip.skipped)
    }

    @Test
    fun `one stop past the window is the last anyway, and drawn in its place rather than skipped`() {
        // Stop 20 next: 21, 22, 23 ahead, then 25 one past them, with only 24 between. That one's shown.
        val strip = strip(trip(ride(bogorLine), TripPhase.RIDING, 19.5), at = 46)!!

        assertEquals(listOf(18, 19, 20, 21, 22, 23, 24, 25), strip.stops.map { it.index })
        assertEquals(0, strip.skipped)
    }

    @Test
    fun `a one-hop ride while boarding is the stop and the stop to get off at`() {
        val strip = strip(trip(ride(bogorLine.take(2)), TripPhase.WAITING_TO_BOARD, 0.0), at = 0)!!

        assertEquals(listOf(0, 1), strip.stops.map { it.index })
        assertEquals(0, strip.skipped)
        assertTrue(strip.stops.last().last)
    }

    @Test
    fun `stopped at a station, its own pill has no minutes`() {
        val strip = strip(trip(ride(bogorLine), TripPhase.RIDING, 10.0, PositionSource.CONFIRMED), at = 23)!!

        assertNull(strip.stops.single { it.focus }.minutes)
    }

    @Test
    fun `an untimed bus has no minutes anywhere`() {
        val strip = strip(trip(ride(bogorLine.take(8), line = "TJ:4D", timed = false), TripPhase.RIDING, 2.5, PositionSource.UNKNOWN), at = 10)!!

        assertTrue(strip.stops.all { it.minutes == null })
    }

    @Test
    fun `arrived, there's no strip`() {
        assertNull(strip(trip(ride(bogorLine), TripPhase.ARRIVED, 25.0), at = 60))
    }
}
