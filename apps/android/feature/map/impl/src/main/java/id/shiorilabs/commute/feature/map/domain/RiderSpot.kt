package id.shiorilabs.commute.feature.map.domain

import kotlin.math.floor

/*
 * A running trip on the map. The map is schematic, so a fix can't be placed on it: the rider is put
 * where the trip engine says they are along the ride, a stop index and the way to the next, on the
 * drawing of that ride between those two stations.
 */

/**
 * Where a trip stands, as the map draws it: ride [legIndex] of the route's legs, [riding] it or
 * waiting to board, or [arrived]; [position] along it as a stop index plus the fraction to the next
 * (`2.5` is halfway between its third and fourth stops); [confirmed] by a recent fix rather than
 * the timetable; [walkingFromLeg], the ride just got off, while walking to this one.
 */
data class RideProgress(
    val legIndex: Int,
    val riding: Boolean,
    val arrived: Boolean,
    val position: Double,
    val confirmed: Boolean,
    val walkingFromLeg: Int? = null,
)

/** Where the rider is drawn, and whether a fix puts them there, or only the timetable. */
data class RiderSpot(val at: WorldPoint, val confirmed: Boolean)

/**
 * The rider in the app's pink, as the live trip's board and timeline draw them: in a line's own
 * colour, a rider beside a stop read as a second marker of it.
 */
private val RIDER_PINK = Rgb(0xF5 / 255.0, 0x58 / 255.0, 0x75 / 255.0)

/** The stretch behind a rider: ridden, greyed. */
private val RIDDEN_COLOR = Rgb(0.7, 0.72, 0.76)

/** The rider's disc, drawn over the whole route. */
const val RIDER_RADIUS_WORLD = 18.0

private fun RidePath.pointAt(arc: Double): WorldPoint? {
    if (path.size < 2) return path.firstOrNull()
    return pointAtArcLength(PreparedCorridor(path, "", 0.0), arc)
}

/** The arc along this ride at [position]: between its stops' arcs by the fraction. */
private fun RidePath.arcAt(position: Double): Double {
    if (stopArcs.isEmpty()) return 0.0
    val clamped = position.coerceIn(0.0, (stopArcs.size - 1).toDouble())
    val k = floor(clamped).toInt().coerceAtMost(stopArcs.size - 1)
    val next = (k + 1).coerceAtMost(stopArcs.size - 1)
    return stopArcs[k] + (clamped - k) * (stopArcs[next] - stopArcs[k])
}

/**
 * Where [progress] puts the rider on [model]'s drawing: at the boarding stop while waiting, along
 * the ride while on it, at the end of the ride left while walking to the next, at the destination
 * once there. Null when the ride isn't drawn.
 */
fun riderSpot(model: RouteOverlayModel, progress: RideProgress): RiderSpot? {
    val rides = model.rides
    if (progress.arrived) {
        val last = rides.lastOrNull() ?: return null
        return last.pointAt(last.stopArcs.lastOrNull() ?: 0.0)?.let { RiderSpot(it, progress.confirmed) }
    }
    val walkingFrom = progress.walkingFromLeg?.let { leg -> rides.firstOrNull { it.legIndex == leg } }
    if (walkingFrom != null) {
        return walkingFrom.pointAt(walkingFrom.stopArcs.lastOrNull() ?: 0.0)?.let { RiderSpot(it, progress.confirmed) }
    }
    val ride = rides.firstOrNull { it.legIndex == progress.legIndex } ?: return null
    val arc = if (progress.riding) ride.arcAt(progress.position) else ride.stopArcs.firstOrNull() ?: 0.0
    return ride.pointAt(arc)?.let { RiderSpot(it, progress.confirmed) }
}

/**
 * The stretches already behind the rider, greyed over the route's own fill: every ride before the
 * current one, the current one up to the rider while on it, and the whole route once arrived.
 */
fun riddenSegments(model: RouteOverlayModel, progress: RideProgress): List<RouteSegment> =
    model.rides.flatMap { ride ->
        val path = when {
            progress.arrived || ride.legIndex < progress.legIndex -> ride.path
            ride.legIndex == progress.legIndex && progress.riding ->
                if (ride.path.size < 2) emptyList() else extractSubPolyline(PreparedCorridor(ride.path, "", 0.0), 0.0, ride.arcAt(progress.position))
            else -> emptyList()
        }
        (1 until path.size).map { k ->
            RouteSegment(path[k - 1].x, path[k - 1].y, path[k].x, path[k].y, ride.halfWidth, RIDDEN_COLOR, RouteSegmentKind.RIDE)
        }
    }

/**
 * The rider as capsules: a white-cased pink disc, solid where a fix put them, a ring with a white
 * core where only the timetable does.
 */
fun riderDrawItems(spot: RiderSpot): List<RouteDrawItem> {
    val (x, y) = spot.at
    val white = Rgb(1.0, 1.0, 1.0)
    return buildList {
        add(RouteDrawItem(x, y, x, y, RIDER_RADIUS_WORLD + ROUTE_CASING_EXTRA_WORLD * 2, white))
        add(RouteDrawItem(x, y, x, y, RIDER_RADIUS_WORLD, RIDER_PINK))
        if (!spot.confirmed) add(RouteDrawItem(x, y, x, y, RIDER_RADIUS_WORLD * 0.55, white))
    }
}
