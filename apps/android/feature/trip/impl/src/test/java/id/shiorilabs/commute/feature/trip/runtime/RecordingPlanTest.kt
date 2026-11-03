package id.shiorilabs.commute.feature.trip.runtime

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
import org.junit.Test

class RecordingPlanTest {

    private val cLine = listOf("Cakung", "Klender Baru", "Sudirman").mapIndexed { k, name -> TripStop("KCI-C$k", name, -6.2, 106.90 - 0.01 * k) }
    private val bus = listOf("Dukuh Atas BSI", "Setiabudi").mapIndexed { k, name -> TripStop("TJ-B$k", name, -6.201 - 0.01 * k, 106.85) }

    /** The C line, a walk, then a TJ bus. */
    private val plan = TripPlan(
        listOf(
            TripLeg.Ride("KCI:C", "KCI", "Angke", null, cLine, minutes(0), minutes(20)),
            TripLeg.Transfer(cLine.last(), bus.first(), distanceM = 150),
            TripLeg.Ride("TJ:1", "TJ", "Blok M", null, bus, minutes(25), minutes(32)),
        ),
    )

    private fun trip(leg: Int, phase: TripPhase) =
        ActiveTrip(plan, TripEngine.start(plan, NOW, hasLocation = true).state.copy(legIndex = leg, phase = phase), origin)

    @Test
    fun `with neither switch on, nothing is recorded`() {
        assertNull(recordedLeg(trip(0, TripPhase.RIDING), imuSpeed = false, detailed = false))
    }

    @Test
    fun `with only Kecepatan IMU, a train is recorded while it's ridden, as before`() {
        assertNull(recordedLeg(trip(0, TripPhase.WAITING_TO_BOARD), imuSpeed = true, detailed = false))
        assertEquals(
            RecordedLeg(0, plan.ride(0), motion = true, detailed = false),
            recordedLeg(trip(0, TripPhase.RIDING), imuSpeed = true, detailed = false),
        )
        assertNull(recordedLeg(trip(2, TripPhase.RIDING), imuSpeed = true, detailed = false))
        assertNull(recordedLeg(trip(2, TripPhase.ARRIVED), imuSpeed = true, detailed = false))
    }

    @Test
    fun `detailed, a train is recorded from the platform, with motion only if Kecepatan IMU is on`() {
        assertEquals(
            RecordedLeg(0, plan.ride(0), motion = false, detailed = true),
            recordedLeg(trip(0, TripPhase.WAITING_TO_BOARD), imuSpeed = false, detailed = true),
        )
        assertEquals(
            RecordedLeg(0, plan.ride(0), motion = true, detailed = true),
            recordedLeg(trip(0, TripPhase.WAITING_TO_BOARD), imuSpeed = true, detailed = true),
        )
    }

    @Test
    fun `detailed, a bus is recorded too, from the walk to it until arrived, never with motion`() {
        for (phase in listOf(TripPhase.WAITING_TO_BOARD, TripPhase.RIDING, TripPhase.ARRIVED)) {
            assertEquals(
                RecordedLeg(2, plan.ride(2), motion = false, detailed = true),
                recordedLeg(trip(2, phase), imuSpeed = true, detailed = true),
            )
        }
    }

    @Test
    fun `no trip, no recording`() {
        assertNull(recordedLeg(null, imuSpeed = true, detailed = true))
    }
}
