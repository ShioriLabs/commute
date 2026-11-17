package id.shiorilabs.commute.feature.map.domain

/**
 * Roughly where on the map the rider is, from the stations nearest them as the crow flies, each
 * `stationId to metres`: their markers averaged, the nearer weighing more. The map isn't drawn to
 * scale, so this is only ever approximate. Null when none of them is on the map.
 */
fun approximateSpot(points: List<MapPoint>, near: List<Pair<String, Int>>): Pair<Double, Double>? {
    var x = 0.0
    var y = 0.0
    var total = 0.0
    for ((stationId, distanceM) in near) {
        val marker = points.markerOf(stationId) ?: continue
        val weight = 1.0 / (distanceM.coerceAtLeast(0) + SPOT_SOFTENING_M)
        x += marker.centerX * weight
        y += marker.centerY * weight
        total += weight
    }
    return if (total == 0.0) null else x / total to y / total
}

/** Keeps a station the rider stands on from outweighing every other entirely. */
private const val SPOT_SOFTENING_M = 50.0
