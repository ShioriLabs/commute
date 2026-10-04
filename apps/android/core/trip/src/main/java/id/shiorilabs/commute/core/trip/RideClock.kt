package id.shiorilabs.commute.core.trip

import id.shiorilabs.commute.core.geo.distanceM
import java.time.Duration
import java.time.Instant
import kotlin.math.floor

/**
 * Where a timed ride's vehicle should be at a given moment, and when it should be at a given
 * position.
 *
 * The API gives times for the two ends of a leg only, so the stops between are placed in proportion
 * to the distance along the line when every stop has coordinates, and evenly by stop count
 * otherwise. Neither knows about dwell times; per-stop times from the API would replace both.
 */
internal class RideClock(private val ride: TripLeg.Ride) {

    /** Cumulative weight at each stop: distance from the boarding stop, or the stop index. */
    private val weights: DoubleArray = run {
        val points = ride.stops.map { it.point }
        if (points.all { it != null }) {
            val cumulative = DoubleArray(points.size)
            for (i in 1 until points.size) cumulative[i] = cumulative[i - 1] + distanceM(points[i - 1]!!, points[i]!!)
            // Two stops at one spot would make a zero-length hop no clock can cross.
            if (cumulative.last() > 0 && (1 until points.size).all { cumulative[it] > cumulative[it - 1] }) cumulative
            else DoubleArray(points.size) { it.toDouble() }
        } else {
            DoubleArray(points.size) { it.toDouble() }
        }
    }

    private val total = weights.last()

    /** The position at [at], already corrected for lateness, clamped to the ride; `null` untimed. */
    fun positionAt(at: Instant): Double? {
        val departure = ride.departureAt ?: return null
        val arrival = ride.arrivalAt ?: return null
        if (!ride.isTimed) return null
        val span = Duration.between(departure, arrival).toMillis().toDouble()
        val fraction = (Duration.between(departure, at).toMillis() / span).coerceIn(0.0, 1.0)
        val target = fraction * total
        for (i in 0 until weights.lastIndex) {
            if (target <= weights[i + 1]) {
                return i + (target - weights[i]) / (weights[i + 1] - weights[i])
            }
        }
        return ride.lastIndex.toDouble()
    }

    /** When the vehicle is scheduled to be at [position], before any lateness; `null` untimed. */
    fun scheduledAt(position: Double): Instant? {
        val departure = ride.departureAt ?: return null
        val arrival = ride.arrivalAt ?: return null
        if (!ride.isTimed) return null
        val clamped = position.coerceIn(0.0, ride.lastIndex.toDouble())
        val i = floor(clamped).toInt().coerceAtMost(ride.lastIndex - 1)
        val weight = weights[i] + (clamped - i) * (weights[i + 1] - weights[i])
        val span = Duration.between(departure, arrival).toMillis()
        return departure.plusMillis((span * (weight / total)).toLong())
    }
}
