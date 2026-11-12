package id.shiorilabs.commute.core.trip

import kotlin.math.floor

/**
 * Stations below ground, where no satellite reaches: MRT Jakarta from Senayan to Bundaran HI. Their
 * platforms still get the location provider's fixes, ±5 m standing there, but once the train is in
 * the tunnel it repeats the last one: on 12 Nov out of Dukuh Atas it read 0.07 m/s at the platform
 * for 25 s after the train left, then ±100 m on one spot until Bundaran HI. Hand-kept, like
 * [longestTrainM]'s consists.
 */
private val UNDERGROUND = setOf("MRTJ-SNY", "MRTJ-IST", "MRTJ-BNH", "MRTJ-STB", "MRTJ-DKA", "MRTJ-BHI")

/** Whether stop [index] of this ride is underground. */
internal fun TripLeg.Ride.isUnderground(index: Int): Boolean = stops.getOrNull(index)?.id in UNDERGROUND

/** Out of one station and not yet in the next, at [position], with either of them underground. */
internal fun TripLeg.Ride.inUndergroundHop(position: Double): Boolean {
    if (position == floor(position)) return false
    val from = floor(position).toInt()
    return isUnderground(from) || isUnderground(from + 1)
}
