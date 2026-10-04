package id.shiorilabs.commute.feature.station.data

import arrow.core.Either
import id.shiorilabs.commute.core.type.Failure
import id.shiorilabs.commute.feature.station.domain.Station

/**
 * Every searchable station at once, with its coordinates: what "near you" ranks and what trip mode
 * places a journey's stops with. Routing-only stops (some TransJakarta haltes) are not in it, so a
 * lookup by id can miss. Cached like the rest, on disk too, for an hour at a time.
 */
interface StationDirectory {

    suspend fun all(): Either<Failure, List<Station>>

    /** The directory if it has been loaded, without asking. */
    fun cached(): List<Station>? = null
}
