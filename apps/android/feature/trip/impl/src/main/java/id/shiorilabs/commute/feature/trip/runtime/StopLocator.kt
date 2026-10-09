package id.shiorilabs.commute.feature.trip.runtime

import id.shiorilabs.commute.core.trip.TripLeg
import id.shiorilabs.commute.core.trip.TripPlan
import id.shiorilabs.commute.core.trip.TripStop
import id.shiorilabs.commute.feature.station.data.StationDirectory
import javax.inject.Inject

/** Gives a plan's stops their coordinates, and its hops their shapes, so fixes can be matched against them. */
fun interface StopLocator {

    suspend fun place(plan: TripPlan): TripPlan
}

/**
 * Places the stops the trip answer left without coordinates, from the station directory, the cached
 * copy first. A stop it doesn't list or has no coordinates for stays unplaced: the engine times it
 * by the clock. Offline with nothing cached, the plan goes through as it came.
 *
 * Each ride's hops get their track shapes too, from the copy held. A hop without one, or every hop
 * with no shapes to be had, stays the straight line between its stops.
 */
class DirectoryStopLocator @Inject constructor(
    private val directory: StationDirectory,
    private val trackShapes: TrackShapeSource,
) : StopLocator {

    override suspend fun place(plan: TripPlan): TripPlan {
        val shapes = trackShapes.shapes().orEmpty()
        val stops = plan.legs.flatMap { leg ->
            when (leg) {
                is TripLeg.Ride -> leg.stops
                is TripLeg.Transfer -> listOf(leg.from, leg.to)
            }
        }
        val stations = if (stops.all { it.point != null }) {
            emptyMap()
        } else {
            (directory.cached() ?: directory.all().getOrNull())?.associateBy { it.id }.orEmpty()
        }
        fun TripStop.placed(): TripStop {
            if (point != null) return this
            val station = stations[id] ?: return this
            return copy(latitude = station.latitude, longitude = station.longitude)
        }
        return TripPlan(
            plan.legs.map { leg ->
                when (leg) {
                    is TripLeg.Ride -> leg.copy(
                        stops = leg.stops.map { it.placed() },
                        hopShapes = if (shapes.isEmpty()) {
                            leg.hopShapes
                        } else {
                            leg.stops.zipWithNext { a, b -> shapes["${a.id}>${b.id}"] }
                        },
                    )
                    is TripLeg.Transfer -> leg.copy(from = leg.from.placed(), to = leg.to.placed())
                }
            },
        )
    }
}
