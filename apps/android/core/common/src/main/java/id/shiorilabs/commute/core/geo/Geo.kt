package id.shiorilabs.commute.core.geo

import kotlin.math.asin
import kotlin.math.cos
import kotlin.math.sqrt

/** A place on the ground, in degrees. */
data class GeoPoint(val latitude: Double, val longitude: Double)

private const val EARTH_RADIUS_M = 6_371_008.8

/** Great-circle distance in metres. */
fun distanceM(a: GeoPoint, b: GeoPoint): Double {
    val dLat = Math.toRadians(b.latitude - a.latitude)
    val dLon = Math.toRadians(b.longitude - a.longitude)
    val h = sin2(dLat / 2) + cos(Math.toRadians(a.latitude)) * cos(Math.toRadians(b.latitude)) * sin2(dLon / 2)
    return 2 * EARTH_RADIUS_M * asin(sqrt(h.coerceIn(0.0, 1.0)))
}

private fun sin2(x: Double): Double = kotlin.math.sin(x).let { it * it }

/**
 * Where [point] falls along the segment [from]→[to].
 *
 * @property fraction 0 at [from], 1 at [to], clamped: a point beyond either end projects onto it.
 * @property offTrackM How far [point] is from the segment at that projection.
 */
data class Projection(val fraction: Double, val offTrackM: Double)

/**
 * Projects [point] onto the segment [from]→[to] on a local flat plane, which is exact enough for the
 * few kilometres between two stations and much cheaper than the spherical form.
 */
fun project(point: GeoPoint, from: GeoPoint, to: GeoPoint): Projection {
    val metresPerDegLat = Math.PI * EARTH_RADIUS_M / 180
    val metresPerDegLon = metresPerDegLat * cos(Math.toRadians(from.latitude))
    val bx = (to.longitude - from.longitude) * metresPerDegLon
    val by = (to.latitude - from.latitude) * metresPerDegLat
    val px = (point.longitude - from.longitude) * metresPerDegLon
    val py = (point.latitude - from.latitude) * metresPerDegLat
    val lengthSq = bx * bx + by * by
    val t = if (lengthSq == 0.0) 0.0 else ((px * bx + py * by) / lengthSq).coerceIn(0.0, 1.0)
    val dx = px - t * bx
    val dy = py - t * by
    return Projection(fraction = t, offTrackM = sqrt(dx * dx + dy * dy))
}

/** How far a path runs, end to end, in metres. */
fun pathLengthM(path: List<GeoPoint>): Double {
    var metres = 0.0
    for (i in 1 until path.size) metres += distanceM(path[i - 1], path[i])
    return metres
}

/**
 * Where [point] falls along [path]: projected onto its nearest segment, with
 * [Projection.fraction] the share of the path's length up to that point. A path too short to have a
 * length is the straight line between its ends.
 */
fun projectOnPath(point: GeoPoint, path: List<GeoPoint>): Projection {
    val total = pathLengthM(path)
    if (path.size < 2 || total == 0.0) return project(point, path.first(), path.last())
    var before = 0.0
    var bestAlong = 0.0
    var bestOffTrack = Double.MAX_VALUE
    for (i in 1 until path.size) {
        val segment = distanceM(path[i - 1], path[i])
        val projection = project(point, path[i - 1], path[i])
        if (projection.offTrackM < bestOffTrack) {
            bestOffTrack = projection.offTrackM
            bestAlong = before + projection.fraction * segment
        }
        before += segment
    }
    return Projection(fraction = (bestAlong / total).coerceIn(0.0, 1.0), offTrackM = bestOffTrack)
}

/**
 * Decodes Google's encoded polyline format (latitude first, then longitude, each a zig-zag varint
 * delta in 5-bit chunks), as the API's track shapes are written.
 * https://developers.google.com/maps/documentation/utilities/polylinealgorithm
 */
fun decodePolyline(encoded: String, precision: Int = 5): List<GeoPoint> {
    val factor = Math.pow(10.0, precision.toDouble())
    val out = mutableListOf<GeoPoint>()
    var i = 0
    var lat = 0
    var lng = 0
    fun next(): Int {
        var shift = 0
        var result = 0
        var b: Int
        do {
            b = encoded[i++].code - 63
            result = result or ((b and 0x1f) shl shift)
            shift += 5
        } while (b >= 0x20)
        return if (result and 1 != 0) (result shr 1).inv() else result shr 1
    }
    while (i < encoded.length) {
        lat += next()
        lng += next()
        out += GeoPoint(lat / factor, lng / factor)
    }
    return out
}
