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
