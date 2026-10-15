package id.shiorilabs.commute.wear

import id.shiorilabs.commute.core.trip.FinishReason
import id.shiorilabs.commute.core.trip.PositionSource
import id.shiorilabs.commute.core.trip.TripLeg
import id.shiorilabs.commute.core.trip.TripLocationMode
import id.shiorilabs.commute.core.trip.TripPhase
import id.shiorilabs.commute.core.trip.TripPlan
import id.shiorilabs.commute.core.trip.TripState
import id.shiorilabs.commute.core.trip.TripStop
import id.shiorilabs.commute.core.wearable.WearLine
import id.shiorilabs.commute.core.wearable.WearTrip
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant

class TripComplicationTest {

    private val now = Instant.parse("2026-10-16T01:00:00Z")
    private fun at(minutes: Long) = now.plusSeconds(minutes * 60)

    private val krl = TripLeg.Ride(
        line = "KCI:B",
        operator = "KCI",
        stops = listOf(
            TripStop("A", "Manggarai", scheduledAt = at(4)),
            TripStop("B", "Tebet", scheduledAt = at(7)),
            TripStop("C", "Cawang", scheduledAt = at(10)),
        ),
        departureAt = at(4),
        arrivalAt = at(10),
    )
    private val bus = TripLeg.Ride(
        line = "TJ:9",
        operator = "TJ",
        stops = listOf(TripStop("D", "Cawang Ciliwung"), TripStop("E", "Cikoko"), TripStop("F", "Pancoran")),
    )
    private val plan = TripPlan(listOf(krl, bus))
    private val lines = mapOf("KCI:B" to WearLine("Lin Bogor", RED), "TJ:9" to WearLine("Pinang Ranti - Pluit", TEAL))

    @Test
    fun `no trip, or one that's over, has nothing to show`() {
        assertNull(tripComplication(null, now))
        assertNull(tripComplication(WearTrip(plan, state(0, TripPhase.ARRIVED, 2.0), lines, FinishReason.ARRIVED), now))
    }

    @Test
    fun `waiting, it counts down to the train, with the boarding icon`() {
        val content = tripComplication(WearTrip(plan, state(0, TripPhase.WAITING_TO_BOARD, 0.0), lines), now)!!
        assertEquals(Hero.Minutes(4), content.hero)
        assertEquals(at(4), content.countdownTo)
        assertTrue(content.boarding)
        assertEquals(0f, content.progress)
    }

    @Test
    fun `aboard, it counts down to getting off and fills with the ride`() {
        val content = tripComplication(WearTrip(plan, state(0, TripPhase.RIDING, 1.0), lines), now)!!
        assertEquals(at(10), content.countdownTo)
        assertFalse(content.boarding)
        // One of the trip's four hops ridden.
        assertEquals(0.25f, content.progress, 0.001f)
    }

    @Test
    fun `an untimed bus counts its haltes, with nothing to count down to`() {
        val content = tripComplication(WearTrip(plan, state(1, TripPhase.RIDING, 0.0), lines), now)!!
        assertEquals(Hero.StopsLeft(2, bus = true), content.hero)
        assertNull(content.countdownTo)
    }

    @Test
    fun `each ride's colour, in order, unknown lines in the accent`() {
        val content = tripComplication(WearTrip(plan, state(0, TripPhase.RIDING, 1.0), mapOf("KCI:B" to WearLine("Lin Bogor", RED))), now)!!
        assertEquals(listOf(RED, ACCENT), content.colors)
    }

    private fun state(legIndex: Int, phase: TripPhase, position: Double) = TripState(
        legIndex = legIndex,
        phase = phase,
        position = position,
        source = PositionSource.CONFIRMED,
        hasLocation = true,
        locationMode = TripLocationMode.PRECISE,
        startedAt = now,
    )

    private companion object {
        val RED = 0xFFEE3D43.toInt()
        val TEAL = 0xFF45A49E.toInt()
        val ACCENT = 0xFFF55875.toInt()
    }
}
