package id.shiorilabs.commute.wear

import id.shiorilabs.commute.core.trip.PositionSource
import id.shiorilabs.commute.core.trip.TripLeg
import id.shiorilabs.commute.core.trip.TripLocationMode
import id.shiorilabs.commute.core.trip.TripPhase
import id.shiorilabs.commute.core.trip.TripPlan
import id.shiorilabs.commute.core.trip.TripState
import id.shiorilabs.commute.core.trip.TripStop
import id.shiorilabs.commute.wear.Moment.Kind.ALIGHT
import id.shiorilabs.commute.wear.Moment.Kind.BOARD
import id.shiorilabs.commute.wear.Moment.Status.AHEAD
import id.shiorilabs.commute.wear.Moment.Status.NEXT
import id.shiorilabs.commute.wear.Moment.Status.PASSED
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.time.Instant

class TripMomentsTest {

    private val base = Instant.parse("2026-10-04T12:00:00Z")
    private fun at(minutes: Long) = base.plusSeconds(minutes * 60)

    private val krl = TripLeg.Ride(
        line = "KCI:B",
        operator = "KCI",
        platformCode = "6/7",
        stops = listOf(
            TripStop("MRI", "Manggarai", scheduledAt = at(0)),
            TripStop("SUD", "Sudirman", scheduledAt = at(9)),
        ),
        departureAt = at(0),
        arrivalAt = at(9),
    )
    private val mrt = TripLeg.Ride(
        line = "MRTJ:M",
        operator = "MRTJ",
        stops = listOf(
            TripStop("DKA", "Dukuh Atas BNI", scheduledAt = at(15)),
            TripStop("IST", "Istora Mandiri", scheduledAt = at(20)),
        ),
        departureAt = at(15),
        arrivalAt = at(20),
    )
    private val walk = TripLeg.Transfer(TripStop("SUD", "Sudirman"), TripStop("DKA", "Dukuh Atas BNI"), distanceM = 350)
    private val plan = TripPlan(listOf(krl, walk, mrt))

    @Test
    fun `a getting on and a getting off for each ride, in order`() {
        val moments = tripMoments(plan, state(0, TripPhase.WAITING_TO_BOARD))
        assertEquals(listOf(BOARD, ALIGHT, BOARD, ALIGHT), moments.map { it.kind })
        assertEquals(listOf("Manggarai", "Sudirman", "Dukuh Atas BNI", "Istora Mandiri"), moments.map { it.place })
        assertEquals(listOf(0, 0, 2, 2), moments.map { it.legIndex })
    }

    @Test
    fun `the next moment is the boarding while it is waited for`() {
        val moments = tripMoments(plan, state(0, TripPhase.WAITING_TO_BOARD))
        assertEquals(listOf(NEXT, AHEAD, AHEAD, AHEAD), moments.map { it.status })
    }


    @Test
    fun `only the boarding waited for names the trains after it`() {
        val withLater = krl.copy(nextDepartures = listOf(at(8), at(16)))
        val laterPlan = TripPlan(listOf(withLater, walk, mrt))

        assertEquals(listOf(listOf(at(8), at(16)), emptyList(), emptyList(), emptyList()), tripMoments(laterPlan, state(0, TripPhase.WAITING_TO_BOARD)).map { it.later })
        // Aboard, they are no one's fallback any more.
        assertEquals(emptyList<Instant>(), tripMoments(laterPlan, state(0, TripPhase.RIDING)).first().later)
    }
    @Test
    fun `aboard, getting on has passed and getting off is next`() {
        assertEquals(listOf(PASSED, NEXT, AHEAD, AHEAD), tripMoments(plan, state(0, TripPhase.RIDING)).map { it.status })
        assertEquals(listOf(PASSED, PASSED, NEXT, AHEAD), tripMoments(plan, state(2, TripPhase.WAITING_TO_BOARD)).map { it.status })
        assertEquals(listOf(PASSED, PASSED, PASSED, PASSED), tripMoments(plan, state(2, TripPhase.ARRIVED)).map { it.status })
    }

    @Test
    fun `the ride being followed runs late, the rest keep the timetable`() {
        val moments = tripMoments(plan, state(0, TripPhase.RIDING, clockOffsetS = 120))
        assertEquals(listOf(at(2), at(11), at(15), at(20)), moments.map { it.at })
        assertEquals(listOf(2, 2, 0, 0), moments.map { it.lateMinutes })
    }

    @Test
    fun `early is not promised`() {
        val moments = tripMoments(plan, state(0, TripPhase.RIDING, clockOffsetS = -180))
        assertEquals(at(9), moments[1].at)
        assertEquals(0, moments[1].lateMinutes)
    }

    @Test
    fun `boarding says its platform, and the walk to it after a change`() {
        val moments = tripMoments(plan, state(0, TripPhase.WAITING_TO_BOARD))
        assertEquals("6/7", moments[0].platform)
        assertNull(moments[0].walkM)
        assertEquals(350, moments[2].walkM)
        assertNull(moments[1].platform)
    }

    @Test
    fun `an untimed ride has no times`() {
        val bus = TripLeg.Ride(
            line = "TJ:9",
            operator = "TJ",
            stops = listOf(TripStop("A", "Cawang Ciliwung"), TripStop("B", "Semanggi")),
        )
        val moments = tripMoments(TripPlan(listOf(bus)), state(0, TripPhase.RIDING))
        assertEquals(listOf(null, null), moments.map { it.at })
    }

    private fun state(legIndex: Int, phase: TripPhase, clockOffsetS: Long = 0) = TripState(
        legIndex = legIndex,
        phase = phase,
        source = PositionSource.CONFIRMED,
        clockOffsetS = clockOffsetS,
        hasLocation = true,
        locationMode = TripLocationMode.PRECISE,
        startedAt = base,
    )
}
