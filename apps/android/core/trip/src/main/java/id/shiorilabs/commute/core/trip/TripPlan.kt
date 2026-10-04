package id.shiorilabs.commute.core.trip

import id.shiorilabs.commute.core.geo.GeoPoint
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import java.time.Instant

/**
 * The journey a rider is following, copied onto the device when they start it so trip mode works
 * with no network at all. Built from a trip answer's journey by whoever starts the trip.
 */
@Serializable
data class TripPlan(
    val legs: List<TripLeg>,
) {

    init {
        require(legs.any { it is TripLeg.Ride }) { "A trip has at least one ride" }
    }

    /** Indices into [legs] of the rides, in order: what progress moves along. */
    val rideIndices: List<Int> get() = legs.indices.filter { legs[it] is TripLeg.Ride }

    fun ride(index: Int): TripLeg.Ride = legs[index] as TripLeg.Ride

    /** Where the trip ends: the last ride's alighting stop. */
    val destination: TripStop get() = ride(rideIndices.last()).stops.last()

    /** The ride after leg [index], skipping the walk between, or `null` after the last. */
    fun nextRideAfter(index: Int): Int? = rideIndices.firstOrNull { it > index }

    /** The walk just before ride [index], when the change is not on the same platform. */
    fun transferBefore(index: Int): TripLeg.Transfer? = legs.getOrNull(index - 1) as? TripLeg.Transfer
}

@Serializable
sealed interface TripLeg {

    @Serializable
    @SerialName("RIDE")
    data class Ride(
        /** `OPERATOR:CODE`. */
        val line: String,
        val operator: String,
        val headsign: String? = null,
        /** Field-verified boarding platform (`3/4`). */
        val platformCode: String? = null,
        /** Boarding to alighting, both included; at least two. */
        val stops: List<TripStop>,
        @Serializable(with = InstantSerializer::class)
        val departureAt: Instant? = null,
        @Serializable(with = InstantSerializer::class)
        val arrivalAt: Instant? = null,
        /** The vehicle run boarded, as the API names it: only ever compared, for "still on my train?". */
        val tripId: String? = null,
    ) : TripLeg {

        init {
            require(stops.size >= 2) { "A ride goes somewhere" }
        }

        val isTimed: Boolean get() = departureAt != null && arrivalAt != null && arrivalAt > departureAt

        val lastIndex: Int get() = stops.lastIndex

        /** TransJakarta haltes sit closer together than stations and are matched more tightly. */
        val isBus: Boolean get() = operator == "TJ"
    }

    @Serializable
    @SerialName("TRANSFER")
    data class Transfer(
        val from: TripStop,
        val to: TripStop,
        val distanceM: Int,
        val corridorLabel: String? = null,
    ) : TripLeg
}

@Serializable
data class TripStop(
    /** `OPERATOR-CODE`. */
    val id: String,
    val name: String,
    val latitude: Double? = null,
    val longitude: Double? = null,
    /** When the boarded trip is timetabled here; `null` untimed, or a stop passed with no recorded time. */
    @Serializable(with = InstantSerializer::class)
    val scheduledAt: Instant? = null,
) {

    /** Where the stop is, when the station data says. A stop without one can't be confirmed. */
    val point: GeoPoint? get() = if (latitude != null && longitude != null) GeoPoint(latitude, longitude) else null
}
