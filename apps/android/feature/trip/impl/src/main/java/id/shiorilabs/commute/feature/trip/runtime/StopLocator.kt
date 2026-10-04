package id.shiorilabs.commute.feature.trip.runtime

import id.shiorilabs.commute.core.trip.TripLeg
import id.shiorilabs.commute.core.trip.TripPlan
import id.shiorilabs.commute.core.trip.TripStop
import id.shiorilabs.commute.feature.station.data.StationDirectory
import javax.inject.Inject

/** Gives a plan's stops their coordinates, so fixes can be matched against them. */
fun interface StopLocator {

    suspend fun place(plan: TripPlan): TripPlan
}

/**
 * Places stops from the station directory, the cached copy first. A stop it doesn't list (a
 * routing-only halte) or one without coordinates stays unplaced: the engine times it by the clock.
 * Offline with nothing cached, the plan goes through as it came.
 */
class DirectoryStopLocator @Inject constructor(private val directory: StationDirectory) : StopLocator {

    override suspend fun place(plan: TripPlan): TripPlan {
        val stations = (directory.cached() ?: directory.all().getOrNull())?.associateBy { it.id } ?: return plan
        fun TripStop.placed(): TripStop {
            if (point != null) return this
            val station = stations[id] ?: return this
            return copy(latitude = station.latitude, longitude = station.longitude)
        }
        return TripPlan(
            plan.legs.map { leg ->
                when (leg) {
                    is TripLeg.Ride -> leg.copy(stops = leg.stops.map { it.placed() })
                    is TripLeg.Transfer -> leg.copy(from = leg.from.placed(), to = leg.to.placed())
                }
            },
        )
    }
}
