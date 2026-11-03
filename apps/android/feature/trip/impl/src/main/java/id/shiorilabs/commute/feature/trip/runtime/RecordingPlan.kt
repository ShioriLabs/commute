package id.shiorilabs.commute.feature.trip.runtime

import id.shiorilabs.commute.core.trip.TripLeg
import id.shiorilabs.commute.core.trip.TripPhase
import id.shiorilabs.commute.feature.trip.ActiveTrip

/**
 * The leg [SensorRecorder] writes a file for, and what goes in it: the motion sensors when [motion],
 * the satellites' own fixes and measurements when [detailed].
 */
data class RecordedLeg(val legIndex: Int, val ride: TripLeg.Ride, val motion: Boolean, val detailed: Boolean)

/**
 * What to record of [trip] now. "Kecepatan IMU" alone records a train while it's ridden, the
 * motion sensors' span. "Rekaman Detail" records every ride, buses too, from the walk to it and the
 * platform, through arriving: the leg the trip is on is always a ride, its walk before it included.
 * The motion sensors join it only on a train, and only with Kecepatan IMU on.
 */
fun recordedLeg(trip: ActiveTrip?, imuSpeed: Boolean, detailed: Boolean): RecordedLeg? {
    val ride = trip?.plan?.legs?.getOrNull(trip.state.legIndex) as? TripLeg.Ride ?: return null
    val leg = trip.state.legIndex
    if (detailed) return RecordedLeg(leg, ride, motion = imuSpeed && !ride.isBus, detailed = true)
    if (imuSpeed && !ride.isBus && trip.state.phase == TripPhase.RIDING) return RecordedLeg(leg, ride, motion = true, detailed = false)
    return null
}
