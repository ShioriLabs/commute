package id.shiorilabs.commute.core.wearable

import id.shiorilabs.commute.core.trip.FinishReason
import id.shiorilabs.commute.core.trip.RiderAction
import id.shiorilabs.commute.core.trip.TripEngine
import id.shiorilabs.commute.core.trip.TripLeg
import id.shiorilabs.commute.core.trip.TripPlan
import id.shiorilabs.commute.core.trip.TripStop
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.time.Instant

class WearTripTest {

    private val now = Instant.parse("2026-10-04T01:00:00Z")

    private val plan = TripPlan(
        listOf(
            TripLeg.Ride(
                line = "KCI:C",
                operator = "KCI",
                headsign = "Bogor",
                stops = listOf(
                    TripStop("KCI-MRI", "Manggarai", -6.2099, 106.8502, now.plusSeconds(300)),
                    TripStop("KCI-TEB", "Tebet", -6.2261, 106.8583, now.plusSeconds(480)),
                ),
                departureAt = now.plusSeconds(300),
                arrivalAt = now.plusSeconds(480),
            ),
        ),
    )

    @Test
    fun `a trip crosses to the watch whole`() {
        val trip = WearTrip(
            plan = plan,
            state = TripEngine.start(plan, now, hasLocation = true).state,
            lines = mapOf("KCI:C" to WearLine("Commuter Line Bogor", 0xFFE30A16.toInt())),
            finished = FinishReason.ARRIVED,
        )
        assertEquals(trip, WearTrip.decode(trip.encode()))
    }

    @Test
    fun `bytes that aren't a trip decode to nothing`() {
        assertNull(WearTrip.decode("{}".encodeToByteArray()))
    }

    @Test
    fun `every action crosses back by name`() {
        RiderAction.entries.forEach { assertEquals(it, WearPaths.decodeAction(WearPaths.encodeAction(it))) }
        assertNull(WearPaths.decodeAction("DANCE".encodeToByteArray()))
    }
}
