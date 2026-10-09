package id.shiorilabs.commute.core.trip

import id.shiorilabs.commute.core.geo.GeoPoint
import id.shiorilabs.commute.core.geo.decodePolyline
import id.shiorilabs.commute.core.geo.distanceM
import id.shiorilabs.commute.core.geo.pathLengthM
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

/** One line that runs a ride's stops, and where it heads. */
@Serializable
data class TripServiceLine(
    /** `OPERATOR:CODE`. */
    val line: String,
    val headsign: String? = null,
)

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
        /**
         * Every line the rider can take for this ride, [line] first: haltes several TransJakarta
         * routes serve in turn, or an interlined stretch of track. Empty when it's [line] alone, as
         * for a trip stored before this was kept.
         */
        val serviceLines: List<TripServiceLine> = emptyList(),
        /**
         * The real shape of each hop, `stops[k]` to `stops[k + 1]`, as an encoded polyline from
         * the API's track shapes; `null` for a hop it has none for, and empty when none were to be
         * had (offline, or a trip stored before this was kept). Without one, a hop is the straight
         * line between its stops.
         */
        val hopShapes: List<String?> = emptyList(),
    ) : TripLeg {

        init {
            require(stops.size >= 2) { "A ride goes somewhere" }
        }

        /** [hopShapes] decoded, once; a delegate, so it isn't stored with the plan. */
        val hopPaths: List<List<GeoPoint>?> by lazy {
            List(lastIndex) { k -> hopShapes.getOrNull(k)?.let(::decodePolyline)?.takeIf { it.size >= 2 } }
        }

        /** The length of hop [k] in metres: along its shape when it has one, else straight. */
        fun hopLengthM(k: Int): Double? {
            hopPaths[k]?.let { return pathLengthM(it) }
            val a = stops[k].point ?: return null
            val b = stops[k + 1].point ?: return null
            return distanceM(a, b)
        }

        val isTimed: Boolean get() = departureAt != null && arrivalAt != null && arrivalAt > departureAt

        val lastIndex: Int get() = stops.lastIndex

        /** TransJakarta haltes sit closer together than stations and are matched more tightly. */
        val isBus: Boolean get() = operator == "TJ"

        /** Every line that will do, [line] first, keyed `OPERATOR:CODE`. */
        val lineKeys: List<String> get() = (listOf(line) + serviceLines.map { it.line }).distinct()

        /** How many lines besides [line] will do. */
        val otherLines: Int get() = lineKeys.size - 1

        /**
         * Where the ride heads, when every line that will do heads there: an L13E boarded for a 4D
         * isn't going the 4D's way, so with lines that part ways there is no saying.
         */
        val sharedHeadsign: String? get() = headsign?.takeIf { serviceLines.all { it.headsign == null || it.headsign == headsign } }
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
