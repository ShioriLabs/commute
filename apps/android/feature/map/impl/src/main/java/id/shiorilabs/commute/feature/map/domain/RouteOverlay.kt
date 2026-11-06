package id.shiorilabs.commute.feature.map.domain

import kotlin.math.abs
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min

/*
 * A journey resolved against the map into drawable geometry, the web's `map-route-overlay.ts`.
 * Each ride pair is read off its traced line where it can be, else matched to a drawn corridor,
 * else chorded; walks are dotted along the artwork's connector, or by rule.
 */

/**
 * One leg of a route as the map draws it: all it reads of a journey or a running trip, so either
 * can be drawn.
 */
sealed interface RouteLeg {

    val fromId: String
    val toId: String

    /** A ride on [line], `OPERATOR:CODE`, calling at [stopIds] from boarding to alighting. */
    data class Ride(val line: String, val operator: String, val stopIds: List<String>) : RouteLeg {
        override val fromId: String get() = stopIds.first()
        override val toId: String get() = stopIds.last()
    }

    /** A walk between two stations. */
    data class Walk(override val fromId: String, override val toId: String) : RouteLeg
}

/** The world-space extent of everything drawn, pins padded by their own size: the camera's fit. */
data class RouteBounds(val minX: Double, val minY: Double, val maxX: Double, val maxY: Double)

/**
 * Where ride [legIndex] runs, as one polyline in travel order, and the arc length along it of each
 * of its stops ([stopArcs], parallel to [RouteLeg.Ride.stopIds]); a stop the map doesn't draw is
 * placed between its neighbours by count. What a running trip's position is drawn along.
 */
class RidePath(val legIndex: Int, val path: List<WorldPoint>, val stopArcs: DoubleArray)

data class RouteOverlayModel(val overlay: RouteOverlay, val bounds: RouteBounds, val rides: List<RidePath>)

/** A walk has no line; it takes this grey, as does a line whose colour hasn't arrived. */
private val TRANSFER_COLOR = Rgb(0.42, 0.45, 0.5)
private const val FALLBACK_LINE_COLOR = "#6B7380"

/**
 * When a matched sub-path is straight and so adds nothing but a parallel offset: only float noise
 * on the ratio, and the offset of an interlined band's full stroke gap (~22), well under an
 * interchange bar's ~40.
 */
private const val STRAIGHT_SUBPATH_MAX_RATIO = 1.001
private const val STRAIGHT_SUBPATH_MAX_OFFSET_WORLD = 25.0

/** A walk's dots this near either station meet its rides on purpose. */
private const val WALK_CLEAR_OF_STATION_WORLD = 50.0

/** A straight walk nearer a ridden line's edge than this bulges round it (Manggarai 16-20, Sudirman 38). */
private const val WALK_CROWDING_WORLD = 28.0

/** How near a connector's end must come to a station's shapes to end there. */
private const val CONNECTOR_STATION_REACH_WORLD = 45.0

private fun distanceToSegment(x: Double, y: Double, ax: Double, ay: Double, bx: Double, by: Double): Double {
    val dx = bx - ax
    val dy = by - ay
    val lengthSquared = dx * dx + dy * dy
    val t = if (lengthSquared == 0.0) 0.0 else (((x - ax) * dx + (y - ay) * dy) / lengthSquared).coerceIn(0.0, 1.0)
    return hypot(x - (ax + t * dx), y - (ay + t * dy))
}

/** The corridor a leg belongs to, elected among the [eligible] ones, else among all. */
private fun electLegCorridor(
    vertices: List<WorldPoint>,
    prepared: List<PreparedCorridor>,
    eligible: ((Int) -> Boolean)?,
): Int? {
    if (eligible == null) return pickLegCorridor(vertices, prepared)
    val indices = prepared.indices.filter(eligible)
    if (indices.isEmpty()) return pickLegCorridor(vertices, prepared)
    return pickLegCorridor(vertices, indices.map { prepared[it] })?.let { indices[it] } ?: pickLegCorridor(vertices, prepared)
}

private class Vertex(val x: Double, val y: Double, val id: String, val stopIndex: Int) {
    val point: WorldPoint get() = WorldPoint(x, y)
}

private class PairPlan(
    val a: Vertex,
    val b: Vertex,
    val i: Int,
    val path: List<WorldPoint>?,
    /** Where the elected corridor passes the pair's two stops, kept when [path] is dropped. */
    val feet: Pair<WorldPoint, WorldPoint>?,
)

private class Walk(val a: WorldPoint, val b: WorldPoint, val fromId: String?, val toId: String?)

/**
 * [legs] drawn on the map: null when nothing could be. Stops with no point on the map are normal
 * (TransJakarta stops the schematic doesn't draw): they're skipped and the line chords across.
 * With no [legs] yet, the pins still come straight from [fromId] and [toId], so a link answers
 * before its fare has.
 *
 * [lineColor] is a line's `#RRGGBB` by key; [corridors], [connectors] and [linePaths] are optional
 * throughout, each pair falling back to a chord without them.
 */
fun buildRouteOverlayModel(
    legs: List<RouteLeg>,
    fromId: String?,
    toId: String?,
    points: List<MapPoint>,
    lineColor: (lineKey: String) -> String?,
    corridors: List<PreparedCorridor> = emptyList(),
    linePaths: PreparedLinePaths? = null,
    connectors: List<List<WorldPoint>> = emptyList(),
): RouteOverlayModel? {
    fun colorOf(line: String): String = lineColor(line) ?: FALLBACK_LINE_COLOR
    val byStation = HashMap<String, MapPoint>()
    // Every shape a station is drawn as: a connector can end at any of them.
    val shapesByStation = HashMap<String, MutableList<MapPoint>>()
    for (p in points) {
        val stationId = p.stationId
        shapesByStation.getOrPut(stationId) { mutableListOf() } += p
        if (p.id == stationId || stationId !in byStation) byStation[stationId] = p
    }
    fun centroid(stationId: String?): WorldPoint? {
        val p = stationId?.let(byStation::get) ?: return null
        return WorldPoint(p.centerX, p.centerY)
    }
    val prepared = corridors.takeIf { it.isNotEmpty() }

    val segments = mutableListOf<RouteSegment>()
    val stops = mutableListOf<RoutePin>()
    val rides = mutableListOf<RidePath>()
    // A station's centroid → where the drawn route passes it (an interchange bar's sits between lines).
    val snapped = HashMap<WorldPoint, WorldPoint>()
    // Drawn after every ride, as the side a walk bulges to depends on where the rides go.
    val walks = mutableListOf<Walk>()

    // Where the previous leg's drawing ended, and its station.
    var cursor: WorldPoint? = null
    var cursorId: String? = null
    // A walk's far end, waiting to see whether a ride follows it.
    var heldWalkTo: WorldPoint? = null
    var heldWalkToId: String? = null
    for ((legIndex, leg) in legs.withIndex()) {
        when (leg) {
            is RouteLeg.Ride -> {
                val vertices = leg.stopIds.mapIndexedNotNull { index, id -> centroid(id)?.let { Vertex(it.x, it.y, id, index) } }
                if (vertices.isEmpty()) continue
                val legColor = colorOf(leg.line)
                val color = Rgb.parse(legColor) ?: TRANSFER_COLOR
                // BRT drawn thinner than rail, as the artwork draws it: a rail line over a busway buries it.
                val isBrt = leg.operator == "TJ"
                val halfWidth = if (isBrt) ROUTE_LINE_HALF_WIDTH_BRT_WORLD else ROUTE_LINE_HALF_WIDTH_WORLD
                val stopRadius = if (isBrt) ROUTE_STOP_RADIUS_BRT_WORLD else ROUTE_STOP_RADIUS_WORLD
                // Where the drawn route meets each station, the centroid until a match says better.
                val marks = vertices.map { it.point }.toMutableList()
                // Along the leg's own drawing, so a running trip can be placed on it.
                val arcs = DoubleArray(vertices.size)

                // The mode gate first and never relaxed (MRT's red sits inside the tolerance of
                // Koridor 1's on one alignment through Dukuh Atas); the colour gate after, relaxed
                // to mode alone when nothing passes, so an unaccountable colour still draws.
                val modeOk: ((Int) -> Boolean)? = prepared?.let { list -> { index -> modeMatches(list[index].width, isBrt) } }
                val eligible: ((Int) -> Boolean)? = prepared?.let { list ->
                    { index -> modeMatches(list[index].width, isBrt) && colourMatches(list[index].color, legColor) }
                }
                val anyEligible = prepared != null && prepared.indices.any { eligible!!(it) }
                val legEligible = if (anyEligible) eligible else modeOk
                // Elected once from every stop, so the drawing doesn't depend on travel direction.
                val preferIndex = prepared?.let { electLegCorridor(vertices.map(Vertex::point), it, legEligible) }

                var prevEnd: WorldPoint? = null
                var length = 0.0
                val firstSegment = segments.size
                fun push(a: WorldPoint, b: WorldPoint) {
                    segments += RouteSegment(a.x, a.y, b.x, b.y, halfWidth, color, RouteSegmentKind.RIDE)
                    length += hypot(b.x - a.x, b.y - a.y)
                }
                // Consecutive pairs can land on different strokes that don't meet: bridge every seam.
                fun bridgeTo(p: WorldPoint) {
                    val end = prevEnd
                    if (end != null && (end.x != p.x || end.y != p.y)) push(end, p)
                }

                // Planned first, drawn second: straightening the whole leg needs every verdict.
                val plans = mutableListOf<PairPlan>()
                for (i in 1 until vertices.size) {
                    val a = vertices[i - 1]
                    val b = vertices[i]
                    if (a.x == b.x && a.y == b.y) continue
                    // The traced stroke already knows it is this line: where it answers, nothing else runs.
                    val traced = sliceLinePath(linePaths, leg.line, a.id, b.id)
                    if (traced != null) {
                        plans += PairPlan(a, b, i, traced, traced.first() to traced.last())
                        continue
                    }
                    val match = prepared?.let { matchCorridorPath(a.x, a.y, b.x, b.y, it, preferIndex = preferIndex, eligible = legEligible) }
                    val path = match?.path
                    var corridorAddsShape = false
                    if (path != null) {
                        val first = path.first()
                        val last = path.last()
                        val offA = hypot(a.x - first.x, a.y - first.y)
                        val offB = hypot(b.x - last.x, b.y - last.y)
                        val endToEnd = hypot(last.x - first.x, last.y - first.y)
                        val straight = endToEnd > 0 && polylineLength(path) <= endToEnd * STRAIGHT_SUBPATH_MAX_RATIO
                        // A straight sub-path within the band of its stops adds only a parallel offset.
                        corridorAddsShape = !straight || offA > STRAIGHT_SUBPATH_MAX_OFFSET_WORLD || offB > STRAIGHT_SUBPATH_MAX_OFFSET_WORLD
                    }
                    // A chord still runs between where the corridor passes, not between centroids
                    // that straddle the band (Koridor 3's, 11 off its stroke).
                    plans += PairPlan(a, b, i, path?.takeIf { corridorAddsShape }, path?.let { it.first() to it.last() })
                }

                // A ruler on the leg: with no pair keeping corridor shape and every stop within the
                // band of one line, the whole leg is one segment on the elected corridor's stroke,
                // extended past its drawn end.
                var flattened = false
                if (prepared != null && plans.isNotEmpty() && plans.all { it.path == null }) {
                    var axis: Pair<WorldPoint, WorldPoint>? = null // point, unit direction
                    if (preferIndex != null) {
                        val corridor = prepared[preferIndex]
                        val feet = vertices.mapNotNull { v ->
                            val projection = projectOntoPolyline(v.x, v.y, corridor)
                            pointAtArcLength(corridor, projection.s).takeIf { projection.dist <= CORRIDOR_MATCH_MAX_DIST_WORLD }
                        }
                        if (feet.size >= 2) {
                            val f = feet.first()
                            val l = feet.last()
                            val len = hypot(l.x - f.x, l.y - f.y)
                            if (len > 0) {
                                val ux = (l.x - f.x) / len
                                val uy = (l.y - f.y) / len
                                // An elected corridor whose serving run bends can't be a ruler.
                                val colinear = feet.all { abs((it.x - f.x) * uy - (it.y - f.y) * ux) <= 0.75 }
                                if (colinear) axis = f to WorldPoint(ux, uy)
                            }
                        }
                    }
                    if (axis == null) {
                        val v0 = vertices.first()
                        val vN = vertices.last()
                        val len = hypot(vN.x - v0.x, vN.y - v0.y)
                        if (len > 0) axis = v0.point to WorldPoint((vN.x - v0.x) / len, (vN.y - v0.y) / len)
                    }
                    if (axis != null) {
                        val (origin, unit) = axis
                        fun along(p: WorldPoint): Double = (p.x - origin.x) * unit.x + (p.y - origin.y) * unit.y
                        fun project(p: WorldPoint): WorldPoint = along(p).let { t -> WorldPoint(origin.x + t * unit.x, origin.y + t * unit.y) }
                        val withinBand = vertices.all { v ->
                            val foot = project(v.point)
                            hypot(v.x - foot.x, v.y - foot.y) <= STRAIGHT_SUBPATH_MAX_OFFSET_WORLD
                        }
                        if (withinBand) {
                            push(project(vertices.first().point), project(vertices.last().point))
                            val start = along(vertices.first().point)
                            vertices.forEachIndexed { i, v ->
                                marks[i] = project(v.point)
                                arcs[i] = abs(along(v.point) - start)
                            }
                            flattened = true
                        }
                    }
                }

                if (!flattened) {
                    for (plan in plans) {
                        val path = plan.path
                        if (path != null) {
                            bridgeTo(path.first())
                            // The later pair wins a shared station, so its dot sits where the line goes on from.
                            marks[plan.i - 1] = path.first()
                            arcs[plan.i - 1] = length
                            for (k in 1 until path.size) push(path[k - 1], path[k])
                            marks[plan.i] = path.last()
                            arcs[plan.i] = length
                            prevEnd = path.last()
                            continue
                        }
                        val from = plan.feet?.first ?: plan.a.point
                        val to = plan.feet?.second ?: plan.b.point
                        bridgeTo(from)
                        marks[plan.i - 1] = from
                        arcs[plan.i - 1] = length
                        push(from, to)
                        marks[plan.i] = to
                        arcs[plan.i] = length
                        prevEnd = to
                    }
                    // A pair skipped for sitting on one spot shares its neighbour's place.
                    for (i in 1 until arcs.size) if (arcs[i] < arcs[i - 1]) arcs[i] = arcs[i - 1]
                }
                rides += RidePath(legIndex, ridePolyline(segments.subList(firstSegment, segments.size), marks), stopArcsOf(leg.stopIds.size, vertices, arcs))

                // The walk in reaches where this leg is drawn, not the centroid it was matched from.
                val arrivedFrom = cursor
                if (arrivedFrom != null && (arrivedFrom.x != marks[0].x || arrivedFrom.y != marks[0].y)) {
                    walks += Walk(arrivedFrom, marks[0], cursorId, vertices[0].id)
                }
                heldWalkTo = null
                // A dot at every station in the ridden line's colour, the schematic's own idiom.
                for (mark in marks) stops += RoutePin(mark.x, mark.y, RoutePinKind.STOP, color, stopRadius)
                vertices.forEachIndexed { i, v -> snapped.putIfAbsent(v.point, marks[i]) }
                cursor = marks.last()
                cursorId = vertices.last().id
            }

            is RouteLeg.Walk -> {
                // A journey that opens on foot walks from its own start; the web drew nothing until
                // a ride had set the cursor, leaving its origin pin stranded.
                if (cursor == null) {
                    cursor = centroid(leg.fromId)
                    cursorId = leg.fromId
                }
                // Held: the next ride walks from the cursor straight to its own first mark, and the
                // far centroid is only the target when no ride follows.
                val held = heldWalkTo
                val at = cursor
                if (held != null && at != null) {
                    walks += Walk(at, held, cursorId, heldWalkToId)
                    cursor = held
                    cursorId = heldWalkToId
                }
                val to = centroid(leg.toId)
                val from = cursor
                heldWalkTo = if (from != null && to != null && (from.x != to.x || from.y != to.y)) to else null
                heldWalkToId = leg.toId
            }
        }
    }
    val lastHeld = heldWalkTo
    val lastCursor = cursor
    if (lastHeld != null && lastCursor != null) walks += Walk(lastCursor, lastHeld, cursorId, heldWalkToId)

    drawWalks(walks, segments, shapesByStation, connectors)

    // The ends take the colour of the leg touching them: boarded at the origin, alighted from at the end.
    fun colorAt(p: WorldPoint, first: Boolean): Rgb? {
        val matches = stops.filter { it.x == p.x && it.y == p.y }
        return (if (first) matches.firstOrNull() else matches.lastOrNull())?.color
    }
    fun snap(p: WorldPoint): WorldPoint = snapped[p] ?: p

    // Where the journey really starts and ends (a stacked stop may answer for the one asked for),
    // the pair standing in until it's known.
    val pins = mutableListOf<RoutePin>()
    (centroid(legs.firstOrNull()?.fromId) ?: centroid(fromId))?.let(::snap)?.let { origin ->
        pins += RoutePin(origin.x, origin.y, RoutePinKind.ORIGIN, colorAt(origin, first = true))
    }
    (centroid(legs.lastOrNull()?.toId) ?: centroid(toId))?.let(::snap)?.let { destination ->
        pins += RoutePin(destination.x, destination.y, RoutePinKind.DESTINATION, colorAt(destination, first = false))
    }
    // One dot a place: an end pin covers its own, and at an interchange the line arrived on owns it.
    val placed = pins.mapTo(HashSet()) { WorldPoint(it.x, it.y) }
    for (stop in stops) if (placed.add(WorldPoint(stop.x, stop.y))) pins += stop

    if (segments.isEmpty() && pins.isEmpty()) return null

    var minX = Double.POSITIVE_INFINITY
    var minY = Double.POSITIVE_INFINITY
    var maxX = Double.NEGATIVE_INFINITY
    var maxY = Double.NEGATIVE_INFINITY
    fun extend(x: Double, y: Double, margin: Double) {
        minX = min(minX, x - margin)
        minY = min(minY, y - margin)
        maxX = max(maxX, x + margin)
        maxY = max(maxY, y + margin)
    }
    for (s in segments) {
        extend(s.ax, s.ay, s.r)
        extend(s.bx, s.by, s.r)
    }
    for (pin in pins) {
        extend(pin.x, pin.y, if (pin.kind == RoutePinKind.STOP) pin.r ?: ROUTE_STOP_RADIUS_WORLD else ROUTE_PIN_RADIUS_WORLD)
    }
    return RouteOverlayModel(RouteOverlay(segments, pins), RouteBounds(minX, minY, maxX, maxY), rides)
}

/**
 * A ride's [drawn] segments as one polyline, chained end to start as the bridges keep them, or its
 * [marks] alone when nothing was drawn.
 */
private fun ridePolyline(drawn: List<RouteSegment>, marks: List<WorldPoint>): List<WorldPoint> {
    if (drawn.isEmpty()) return marks.toList()
    return buildList {
        add(WorldPoint(drawn.first().ax, drawn.first().ay))
        for (s in drawn) add(WorldPoint(s.bx, s.by))
    }
}

/** [arcs] of the drawn stops spread over all [count] of the leg's, undrawn ones placed between by count. */
private fun stopArcsOf(count: Int, vertices: List<Vertex>, arcs: DoubleArray): DoubleArray {
    val out = DoubleArray(count) { Double.NaN }
    vertices.forEachIndexed { i, v -> out[v.stopIndex] = arcs[i] }
    var previous = -1
    for (i in 0 until count) {
        if (out[i].isNaN()) continue
        if (previous == -1) {
            for (k in 0 until i) out[k] = out[i]
        } else {
            for (k in previous + 1 until i) out[k] = out[previous] + (out[i] - out[previous]) * (k - previous) / (i - previous)
        }
        previous = i
    }
    if (previous >= 0) for (k in previous + 1 until count) out[k] = out[previous]
    return out
}

/**
 * Each walk dotted: along the artwork's connector when one joins its two stations, else by rule,
 * straight unless it would crowd a ridden line, then bulged to the side whose dots land on fewer.
 * Drawn after the rides, so a dot crossing a line sits on top of it.
 */
private fun drawWalks(
    walks: List<Walk>,
    segments: MutableList<RouteSegment>,
    shapesByStation: Map<String, List<MapPoint>>,
    connectors: List<List<WorldPoint>>,
) {
    val rides = segments.filter { it.kind == RouteSegmentKind.RIDE }
    fun walkDots(path: List<WorldPoint>) = dotPolyline(roundCorners(path, WALK_CORNER_RADIUS_WORLD), ROUTE_TRANSFER_DOT_SPACING_WORLD)
    // Each dot's gap to the nearest ride's edge, the dots at the stations aside.
    fun clearances(dots: List<WorldPoint>, a: WorldPoint, b: WorldPoint): List<Double> = dots
        .filter { hypot(it.x - a.x, it.y - a.y) >= WALK_CLEAR_OF_STATION_WORLD && hypot(it.x - b.x, it.y - b.y) >= WALK_CLEAR_OF_STATION_WORLD }
        .map { dot -> rides.minOfOrNull { distanceToSegment(dot.x, dot.y, it.ax, it.ay, it.bx, it.by) - it.r } ?: Double.POSITIVE_INFINITY }
    fun collisions(dots: List<WorldPoint>, a: WorldPoint, b: WorldPoint): Int =
        clearances(dots, a, b).count { it < ROUTE_TRANSFER_DOT_RADIUS_WORLD + ROUTE_CASING_EXTRA_WORLD }
    fun stationReach(stationId: String, p: WorldPoint): Double =
        shapesByStation[stationId].orEmpty().minOfOrNull { distanceToSegment(p.x, p.y, it.ax, it.ay, it.bx, it.by) }
            ?: Double.POSITIVE_INFINITY
    // A connector ends on a station's tap target, not its marker (Manggarai's, on the grey bar).
    fun connectorBetween(fromId: String?, toId: String?): List<WorldPoint>? {
        if (fromId == null || toId == null || fromId == toId || connectors.isEmpty()) return null
        var best: List<WorldPoint>? = null
        var bestScore = Double.POSITIVE_INFINITY
        for (connector in connectors) {
            if (connector.size < 2) continue
            val first = connector.first()
            val last = connector.last()
            val forward = stationReach(fromId, first) + stationReach(toId, last)
            val backward = stationReach(fromId, last) + stationReach(toId, first)
            val reversed = backward < forward
            val nearFrom = if (reversed) last else first
            val nearTo = if (reversed) first else last
            if (stationReach(fromId, nearFrom) > CONNECTOR_STATION_REACH_WORLD) continue
            if (stationReach(toId, nearTo) > CONNECTOR_STATION_REACH_WORLD) continue
            val score = min(forward, backward)
            if (score < bestScore) {
                bestScore = score
                best = if (reversed) connector.asReversed() else connector
            }
        }
        return best
    }
    fun dot(p: WorldPoint) {
        segments += RouteSegment(p.x, p.y, p.x, p.y, ROUTE_TRANSFER_DOT_RADIUS_WORLD, TRANSFER_COLOR, RouteSegmentKind.TRANSFER)
    }

    for (walk in walks) {
        val (a, b) = walk.a to walk.b
        val connector = connectorBetween(walk.fromId, walk.toId)
        if (connector != null) {
            // Only the stretch between the walk's ends: a connector can run on past a marker.
            val line = PreparedCorridor(connector, "", 0.0)
            val from = projectOntoPolyline(a.x, a.y, line).s
            val to = projectOntoPolyline(b.x, b.y, line).s
            val slice = if (from < to) {
                buildList {
                    add(pointAtArcLength(line, from))
                    connector.forEachIndexed { i, p -> if (line.cums[i] > from && line.cums[i] < to) add(p) }
                    add(pointAtArcLength(line, to))
                }
            } else {
                connector
            }
            val path = mutableListOf<WorldPoint>()
            for (p in listOf(a) + slice + listOf(b)) {
                val previous = path.lastOrNull()
                if (previous == null || hypot(p.x - previous.x, p.y - previous.y) >= 1) path += p
            }
            walkDots(path).forEach(::dot)
            continue
        }
        var dots = walkDots(octilinearPath(a.x, a.y, b.x, b.y))
        val left = octilinearPath(a.x, a.y, b.x, b.y, -1)
        val right = octilinearPath(a.x, a.y, b.x, b.y, 1)
        val canBulge = left.size > 2 && !samePath(left, right)
        if (canBulge && (clearances(dots, a, b).minOrNull() ?: Double.POSITIVE_INFINITY) < WALK_CROWDING_WORLD) {
            val leftDots = walkDots(left)
            val rightDots = walkDots(right)
            val leftHits = collisions(leftDots, a, b)
            val rightHits = collisions(rightDots, a, b)
            // A tie swings toward the offset, the side the artwork's connectors take.
            val lateral = if (abs(b.x - a.x) < abs(b.y - a.y)) b.x - a.x else b.y - a.y
            dots = if (leftHits < rightHits || (leftHits == rightHits && lateral < 0)) leftDots else rightDots
        }
        dots.forEach(::dot)
    }
}

private fun samePath(a: List<WorldPoint>, b: List<WorldPoint>): Boolean =
    a.size == b.size && a.indices.all { a[it].x == b[it].x && a[it].y == b[it].y }
