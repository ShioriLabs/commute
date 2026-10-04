package id.shiorilabs.commute.core.trip

import id.shiorilabs.commute.core.geo.distanceM
import java.time.Duration
import java.time.Instant
import kotlin.math.floor

/**
 * Where a timed ride's vehicle should be at a given moment, and when it should be at a given
 * position.
 *
 * The API times every stop of a timetabled leg, and those times place the vehicle, uneven hops and
 * all. A stop without one (a gap in the timetable, or a plan saved before stops carried times) is
 * placed between the timed stops around it, in proportion to the distance along the line when every
 * stop has coordinates and by stop count otherwise. Times that run backwards are taken for a slip in
 * the data and the whole ride falls back to that spread between its two ends.
 */
internal class RideClock(private val ride: TripLeg.Ride) {

    /** Each stop's scheduled time as milliseconds after departure; `null` untimed. */
    private val offsets: LongArray? = run {
        val departure = ride.departureAt
        val arrival = ride.arrivalAt
        if (!ride.isTimed || departure == null || arrival == null) return@run null
        val span = Duration.between(departure, arrival).toMillis()
        val weights = weights()
        // The ends are the leg's own times; between them, the API's per-stop times where it has them.
        val known: List<Long?> = ride.stops.mapIndexed { i, stop ->
            when (i) {
                0 -> 0L
                ride.lastIndex -> span
                else -> stop.scheduledAt?.let { Duration.between(departure, it).toMillis() }?.takeIf { it in 0..span }
            }
        }
        val filled = LongArray(known.size)
        var before = 0
        for (i in known.indices) {
            val time = known[i]
            if (time != null) {
                filled[i] = time
                before = i
                continue
            }
            val after = (i + 1..ride.lastIndex).first { known[it] != null }
            val share = (weights[i] - weights[before]) / (weights[after] - weights[before])
            filled[i] = filled[before] + ((known[after]!! - filled[before]) * share).toLong()
        }
        if ((1 until filled.size).all { filled[it] >= filled[it - 1] }) {
            filled
        } else {
            LongArray(weights.size) { (span * (weights[it] / weights.last())).toLong() }
        }
    }

    /** The position at [at], already corrected for lateness, clamped to the ride; `null` untimed. */
    fun positionAt(at: Instant): Double? {
        val offsets = offsets ?: return null
        val elapsed = Duration.between(ride.departureAt, at).toMillis().coerceIn(0, offsets.last())
        for (i in 0 until offsets.lastIndex) {
            // Two stops timed alike (a short hop, rounded to the minute) are passed in one go.
            if (elapsed < offsets[i + 1]) return i + (elapsed - offsets[i]).toDouble() / (offsets[i + 1] - offsets[i])
        }
        return ride.lastIndex.toDouble()
    }

    /** When the vehicle is scheduled to be at [position], before any lateness; `null` untimed. */
    fun scheduledAt(position: Double): Instant? {
        val offsets = offsets ?: return null
        val clamped = position.coerceIn(0.0, ride.lastIndex.toDouble())
        val i = floor(clamped).toInt().coerceAtMost(ride.lastIndex - 1)
        return ride.departureAt!!.plusMillis(offsets[i] + ((clamped - i) * (offsets[i + 1] - offsets[i])).toLong())
    }

    /** Cumulative weight at each stop: distance from the boarding stop, or the stop index. */
    private fun weights(): DoubleArray {
        val points = ride.stops.map { it.point }
        val byIndex = DoubleArray(points.size) { it.toDouble() }
        if (points.any { it == null }) return byIndex
        val cumulative = DoubleArray(points.size)
        for (i in 1 until points.size) cumulative[i] = cumulative[i - 1] + distanceM(points[i - 1]!!, points[i]!!)
        // Two stops at one spot would make a zero-length hop no clock can cross.
        return if (cumulative.last() > 0 && (1 until points.size).all { cumulative[it] > cumulative[it - 1] }) cumulative else byIndex
    }
}
