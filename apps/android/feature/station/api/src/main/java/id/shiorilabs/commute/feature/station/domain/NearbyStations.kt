package id.shiorilabs.commute.feature.station.domain

import id.shiorilabs.commute.core.geo.GeoPoint
import id.shiorilabs.commute.core.geo.distanceM
import kotlin.math.roundToInt

/** A station near the rider, as the crow flies. */
data class NearbyStation(val station: Station, val distanceM: Int)

/** As far as anyone would walk to a station rather than take something to it. */
const val NEARBY_RADIUS_M = 1_500

/**
 * The stations within [radiusM] of [point], nearest first, at most [limit]. A station without
 * coordinates is never near anything.
 */
fun nearbyStations(
    point: GeoPoint,
    stations: List<Station>,
    radiusM: Int = NEARBY_RADIUS_M,
    limit: Int = 5,
): List<NearbyStation> = stations
    .mapNotNull { station ->
        val lat = station.latitude ?: return@mapNotNull null
        val lon = station.longitude ?: return@mapNotNull null
        val distance = distanceM(point, GeoPoint(lat, lon))
        if (distance > radiusM) null else NearbyStation(station, distance.roundToInt())
    }
    .sortedBy { it.distanceM }
    .take(limit)
