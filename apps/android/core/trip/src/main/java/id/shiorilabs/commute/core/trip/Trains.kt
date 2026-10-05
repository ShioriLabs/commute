package id.shiorilabs.commute.core.trip

/** A KRL or MRT Jakarta car, near enough: the 20 m cars both run. */
private const val TWENTY_M_CAR = 20.0

/** An LRT Jabodebek car: a six-car set is about 102 m. */
private const val LRT_JABODEBEK_CAR_M = 17.0

/**
 * An LRT Jakarta car: Hyundai Rotem's two-car set, the Gimpo Goldline's, at 13.7 m a car (two seat
 * 172 between them, which fits two cars, not one).
 */
private const val LRT_JAKARTA_CAR_M = 13.7

/**
 * How long the longest train on [ride]'s line is, in metres, or `null` for a line trip mode doesn't
 * know. The phone can be anywhere along it, so this sets how far from a station's point a stopped
 * train can still put the rider.
 *
 * - Commuter Line: twelve cars, but the Rangkasbitung (`R`) and Tangerang (`T`) lines only ever run ten.
 * - MRT Jakarta and LRT Jabodebek: six.
 * - LRT Jakarta: up to four, two two-car sets coupled.
 */
internal fun longestTrainM(ride: TripLeg.Ride): Double? {
    val code = ride.line.substringAfter(':')
    return when (ride.operator) {
        "KCI" -> (if (code == "R" || code == "T") 10 else 12) * TWENTY_M_CAR
        "MRTJ" -> 6 * TWENTY_M_CAR
        "LRTJBDB" -> 6 * LRT_JABODEBEK_CAR_M
        "LRTJ" -> 4 * LRT_JAKARTA_CAR_M
        else -> null
    }
}
