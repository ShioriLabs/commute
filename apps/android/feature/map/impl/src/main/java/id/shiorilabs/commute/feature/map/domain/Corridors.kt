package id.shiorilabs.commute.feature.map.domain

import kotlinx.serialization.Serializable
import kotlin.math.abs
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.sqrt

/*
 * The artwork's own drawn line paths, the web's `map-corridors.ts`: pure planar geometry over
 * polylines in world units, so a route leg traces the corridor rather than cutting a chord across
 * the map. A corridor carries no line identity, only its colour and stroke width, so a leg is
 * matched to one by geometry, per pair of stops.
 */

/** A point in world units. */
data class WorldPoint(val x: Double, val y: Double)

/**
 * The web's `map-corridors.json`: every drawn corridor, and the artwork's interchange connectors,
 * which only walks follow.
 */
@Serializable
data class MapCorridors(
    val version: String,
    val corridors: List<MapCorridor>,
    val connectors: List<List<List<Double>>> = emptyList(),
)

/**
 * One drawn corridor: its stroke width [w] (25 rail, 15 BRT: the one signal that tells the modes
 * apart, as their palettes overlap), its hex [c], and its flattened points `[x, y]`.
 */
@Serializable
data class MapCorridor(val w: Double, val c: String, val pts: List<List<Double>>)

/** A corridor with its cumulative arc lengths: [cums]`[i]` is the distance from the first point to the `i`th. */
class PreparedCorridor(val pts: List<WorldPoint>, val color: String, val width: Double) {

    val cums: DoubleArray = DoubleArray(pts.size).also { cums ->
        for (i in 1 until pts.size) cums[i] = cums[i - 1] + hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y)
    }

    val length: Double get() = cums.last()
}

/** Where a point lands on a polyline: its distance from the nearest foot, and the foot's arc length. */
data class Projection(val dist: Double, val s: Double)

/**
 * How far a stop may sit from a corridor and still be served by it. Mostly slack: the artwork breaks
 * a BRT corridor at junctions, and where the joining piece is missing a stop's stroke ends short of
 * it (Puri Beta 2 by 101).
 */
const val CORRIDOR_MATCH_MAX_DIST_WORLD = 110.0

/** A corridor reaching both stops the long way round: the worst real rail curve is 1.42× straight. */
const val CORRIDOR_MATCH_MAX_DETOUR_RATIO = 2.5

/** Two feet closer along the stroke than this are one point. */
private const val MIN_SUBPATH_LENGTH = 0.5

/** The two drawn widths are 15 and 25; anything between classifies the same. */
private const val BRT_STROKE_MAX_WIDTH = 20.0

fun MapCorridor.prepared(): PreparedCorridor = PreparedCorridor(pts.map { WorldPoint(it[0], it[1]) }, c, w)

fun prepareCorridors(corridors: List<MapCorridor>): List<PreparedCorridor> =
    corridors.filter { it.pts.size >= 2 }.map { it.prepared() }

/** Whether [width] is drawn as BRT rather than rail. */
fun isBrtStroke(width: Double): Boolean = width <= BRT_STROKE_MAX_WIDTH

/** Whether a corridor of [width] is drawn in the mode of the leg being traced. */
fun modeMatches(width: Double, legIsBrt: Boolean): Boolean = isBrtStroke(width) == legIsBrt

/**
 * The nearest point on [corridor] to ([x], [y]), clamped to each segment. The first, lowest arc
 * length foot wins a tie, so a point on a shared vertex always gives the same sub-path.
 */
fun projectOntoPolyline(x: Double, y: Double, corridor: PreparedCorridor): Projection {
    val pts = corridor.pts
    var bestDist = Double.POSITIVE_INFINITY
    var bestS = 0.0
    for (i in 0 until pts.size - 1) {
        val ax = pts[i].x
        val ay = pts[i].y
        val dx = pts[i + 1].x - ax
        val dy = pts[i + 1].y - ay
        val lenSq = dx * dx + dy * dy
        val t = if (lenSq > 0) (((x - ax) * dx + (y - ay) * dy) / lenSq).coerceIn(0.0, 1.0) else 0.0
        val dist = hypot(x - (ax + t * dx), y - (ay + t * dy))
        if (dist < bestDist) {
            bestDist = dist
            bestS = corridor.cums[i] + t * sqrt(lenSq)
        }
    }
    return Projection(bestDist, bestS)
}

/**
 * The stretch of [corridor] between arc lengths [s0] and [s1], in travel order (backwards when
 * [s1] < [s0]), its ends interpolated rather than snapped to a vertex. Empty when the two are one
 * point.
 */
fun extractSubPolyline(corridor: PreparedCorridor, s0: Double, s1: Double): List<WorldPoint> {
    if (abs(s1 - s0) < MIN_SUBPATH_LENGTH) return emptyList()
    val reversed = s1 < s0
    val lo = if (reversed) s1 else s0
    val hi = if (reversed) s0 else s1
    val out = mutableListOf(pointAtArcLength(corridor, lo))
    for (i in corridor.cums.indices) {
        // Strictly between, so a vertex on an end isn't emitted twice.
        if (corridor.cums[i] > lo && corridor.cums[i] < hi) out += corridor.pts[i]
    }
    out += pointAtArcLength(corridor, hi)
    return if (reversed) out.asReversed() else out
}

/** The point at arc length [s] along [corridor], clamped to its ends. */
fun pointAtArcLength(corridor: PreparedCorridor, s: Double): WorldPoint {
    val pts = corridor.pts
    val cums = corridor.cums
    if (s <= 0) return pts.first()
    if (s >= cums.last()) return pts.last()
    var i = 0
    while (i < cums.size - 2 && cums[i + 1] < s) i++
    val segLen = cums[i + 1] - cums[i]
    val t = if (segLen > 0) (s - cums[i]) / segLen else 0.0
    return WorldPoint(pts[i].x + (pts[i + 1].x - pts[i].x) * t, pts[i].y + (pts[i + 1].y - pts[i].y) * t)
}

fun polylineLength(pts: List<WorldPoint>): Double {
    var total = 0.0
    for (i in 1 until pts.size) total += hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y)
    return total
}

/**
 * A corridor path between two stops: from corridor [index], and [loopArc] when it was admitted
 * only as the last resort round a terminal loop.
 */
data class CorridorMatch(val path: List<WorldPoint>, val index: Int, val loopArc: Boolean = false)

/**
 * The corridor a whole leg belongs to: the one serving the most of its [stops] within [maxDist],
 * the nearest total breaking ties. Pair by pair, a leg staircases between a corridor's two drawn
 * directions; electing from every stop is the same answer whichever end the journey starts from.
 * Null when none reaches two stops.
 */
fun pickLegCorridor(
    stops: List<WorldPoint>,
    corridors: List<PreparedCorridor>,
    maxDist: Double = CORRIDOR_MATCH_MAX_DIST_WORLD,
): Int? {
    var bestIndex: Int? = null
    var bestServed = 0
    var bestTotal = Double.POSITIVE_INFINITY
    for (i in corridors.indices) {
        var served = 0
        var total = 0.0
        for (stop in stops) {
            val dist = projectOntoPolyline(stop.x, stop.y, corridors[i]).dist
            if (dist <= maxDist) {
                served++
                total += dist
            }
        }
        if (served < 2) continue
        if (served > bestServed || (served == bestServed && total < bestTotal)) {
            bestIndex = i
            bestServed = served
            bestTotal = total
        }
    }
    return bestIndex
}

/**
 * The corridor path from ([ax], [ay]) to ([bx], [by]), or null to draw a chord. Both stops must be
 * near the same corridor: at Jatinegara the Cikarang main line passes closer (0.7) than the one the
 * train takes (1.6), and only the partner stop, 704 from the through line, tells them apart.
 *
 * [preferIndex], the leg's elected corridor, is tried first but must pass the same tests.
 * [eligible] filters candidates before they're ranked, not the winner after: where two strokes run
 * parallel the wrong one wins by a world unit.
 */
fun matchCorridorPath(
    ax: Double,
    ay: Double,
    bx: Double,
    by: Double,
    corridors: List<PreparedCorridor>,
    maxDist: Double = CORRIDOR_MATCH_MAX_DIST_WORLD,
    maxDetour: Double = CORRIDOR_MATCH_MAX_DETOUR_RATIO,
    preferIndex: Int? = null,
    eligible: ((Int) -> Boolean)? = null,
): CorridorMatch? {
    val straight = hypot(bx - ax, by - ay)
    if (straight <= 0) return null

    class Candidate(val corridor: PreparedCorridor, val worst: Double, val sa: Double, val sb: Double, val index: Int)

    // A loop arc that passed every test but the ratio, kept in case nothing else fits.
    var loopArc: Pair<CorridorMatch, Double>? = null
    val candidates = corridors.indices
        .mapNotNull { i ->
            val corridor = corridors[i]
            val pa = projectOntoPolyline(ax, ay, corridor)
            val pb = projectOntoPolyline(bx, by, corridor)
            val worst = max(pa.dist, pb.dist)
            Candidate(corridor, worst, pa.s, pb.s, i).takeIf { worst <= maxDist && (eligible == null || eligible(i)) }
        }
        // The elected corridor first, then best fit, the index keeping a near-tie deterministic.
        .sortedWith(
            compareBy<Candidate> { if (preferIndex != null && it.index == preferIndex) 0 else 1 }
                .thenBy { it.worst }
                .thenBy { it.index },
        )

    for (candidate in candidates) {
        val path = extractSubPolyline(candidate.corridor, candidate.sa, candidate.sb)
        if (path.size >= 2 && polylineLength(path) <= maxDetour * straight) {
            // An arc refused on ratio earlier was the better fit; at a loop terminal (TJ:1 at
            // ASEAN, 49.3 against a purple stroke's 81.9) it is the route, when decisively closer.
            val arc = loopArc
            if (arc != null && arc.second * LOOP_ARC_FIT_ADVANTAGE < candidate.worst) return arc.first
            return CorridorMatch(path, candidate.index)
        }
        // A terminal loop's closing leg is a detour by construction (TJ:12 round Kota Tua, 13×):
        // admitted only once everything else has failed the ratio, and only on the stroke.
        if (path.size >= 2 && candidate.worst <= LOOP_ARC_MAX_FIT_WORLD &&
            polylineLength(path) <= LOOP_ARC_MAX_DETOUR_RATIO * straight
        ) {
            if (loopArc == null) loopArc = CorridorMatch(path, candidate.index, loopArc = true) to candidate.worst
        }
        // A ring that closes on its own earlier pass: run out to the stroke's end and resume where
        // it rejoins, as at TJ:1's Blok M terminal.
        val closed = closingPath(candidate.corridor, candidate.sa, candidate.sb)
        if (closed != null && polylineLength(closed) <= maxDetour * straight) return CorridorMatch(closed, candidate.index)
        // The nearest feet can be on the wrong pass of a stroke that doubles back (TJ:7F at
        // Kwitang): try the other passes, as long as each foot is about as near as the nearest.
        val nearestA = projectOntoPolyline(ax, ay, candidate.corridor).dist
        val nearestB = projectOntoPolyline(bx, by, candidate.corridor).dist
        for ((sa, sb) in alternativeFeet(candidate.corridor, ax, ay, bx, by, maxDist)) {
            val alt = extractSubPolyline(candidate.corridor, sa, sb)
            if (alt.size < 2 || polylineLength(alt) > maxDetour * straight) continue
            if (hypot(alt.first().x - ax, alt.first().y - ay) > nearestA + ALTERNATIVE_FOOT_SLACK_WORLD) continue
            if (hypot(alt.last().x - bx, alt.last().y - by) > nearestB + ALTERNATIVE_FOOT_SLACK_WORLD) continue
            return CorridorMatch(alt, candidate.index)
        }
    }
    return loopArc?.first
}

/** How far round a loop a closing leg may travel: TJ:12's 13.08× is the sheet's largest. */
private const val LOOP_ARC_MAX_DETOUR_RATIO = 15.0

/** How near a loop arc must sit to its stops: a terminal draws them beside the circuit. */
private const val LOOP_ARC_MAX_FIT_WORLD = 60.0

/** How much better a loop arc must fit than the straight match that beat it. */
private const val LOOP_ARC_FIT_ADVANTAGE = 1.5

/**
 * The path from [sa] out to the stroke's own end, then on to [sb] from where that end rejoins the
 * stroke: only for a ring drawn as one stroke, closed at its end (Koridor 1, 3H) or its start (12).
 */
private fun closingPath(corridor: PreparedCorridor, sa: Double, sb: Double): List<WorldPoint>? {
    val options = buildList {
        closesOnOwnBody(corridor, atEnd = true)?.let { add(corridor.length to it) }
        closesOnOwnBody(corridor, atEnd = false)?.let { add(0.0 to it) }
    }
    if (options.isEmpty()) return null

    var bestPath: List<WorldPoint>? = null
    var bestLength = abs(sa - sb)
    for ((exit, rejoin) in options) {
        // Leaving by this end must be a real shortcut.
        val viaLength = abs(exit - sa) + abs(sb - rejoin)
        if (viaLength >= bestLength) continue
        val out = extractSubPolyline(corridor, sa, exit)
        val rest = extractSubPolyline(corridor, rejoin, sb)
        if (out.size < 2 || rest.size < 2) continue
        // One vertex at the seam, not a zero-length edge reading as a sudden corner.
        val seamless = hypot(rest.first().x - out.last().x, rest.first().y - out.last().y) < MIN_SUBPATH_LENGTH
        bestLength = viaLength
        bestPath = out + if (seamless) rest.drop(1) else rest
    }
    return bestPath
}

/**
 * The arc length where the stroke's end (or start) meets its own body, closing a ring; null when it
 * doesn't. A wider gap is allowed only along an axis, where a station disc is drawn over the line.
 */
private fun closesOnOwnBody(corridor: PreparedCorridor, atEnd: Boolean): Double? {
    val pts = corridor.pts
    val cums = corridor.cums
    val total = corridor.length
    val tail = if (atEnd) pts.last() else pts.first()
    var bestS = 0.0
    var bestDist = Double.POSITIVE_INFINITY
    var bestDx = 0.0
    var bestDy = 0.0
    for (i in 0 until pts.size - 1) {
        // Clear of the stroke's own neighbourhood, measured from each segment's far side.
        if (atEnd && total - cums[i + 1] < CLOSING_MIN_SEPARATION_WORLD) break
        if (!atEnd && cums[i] < CLOSING_MIN_SEPARATION_WORLD) continue
        val ax = pts[i].x
        val ay = pts[i].y
        val dx = pts[i + 1].x - ax
        val dy = pts[i + 1].y - ay
        val lenSq = dx * dx + dy * dy
        val t = if (lenSq > 0) (((tail.x - ax) * dx + (tail.y - ay) * dy) / lenSq).coerceIn(0.0, 1.0) else 0.0
        val fx = ax + t * dx
        val fy = ay + t * dy
        val dist = hypot(tail.x - fx, tail.y - fy)
        if (dist < bestDist) {
            bestS = cums[i] + t * sqrt(lenSq)
            bestDist = dist
            bestDx = abs(tail.x - fx)
            bestDy = abs(tail.y - fy)
        }
    }
    if (bestDist == Double.POSITIVE_INFINITY) return null
    if (bestDist <= CLOSING_JOIN_WORLD) return bestS
    if (bestDist > CLOSING_COLLINEAR_WORLD) return null
    if (bestDx > CLOSING_AXIS_TOLERANCE_WORLD && bestDy > CLOSING_AXIS_TOLERANCE_WORLD) return null
    return bestS
}

/** A ring drawn as one stroke lands on itself: TJ:1's end is 0.2 off. */
private const val CLOSING_JOIN_WORLD = 6.0

/** ...or this far along one axis, where a disc breaks the line (Koridor 3H, 33.7). */
private const val CLOSING_COLLINEAR_WORLD = 90.0
private const val CLOSING_AXIS_TOLERANCE_WORLD = 3.0

/** An end trivially touches its own last stretch, so the rejoin is looked for beyond it. */
private const val CLOSING_MIN_SEPARATION_WORLD = 200.0

/** Every pair of feet within [maxDist] of the two stops, nearest total first. */
private fun alternativeFeet(
    corridor: PreparedCorridor,
    ax: Double,
    ay: Double,
    bx: Double,
    by: Double,
    maxDist: Double,
): List<Pair<Double, Double>> {
    val feetA = footCandidates(corridor, ax, ay, maxDist)
    val feetB = footCandidates(corridor, bx, by, maxDist)
    return feetA
        .flatMap { a -> feetB.map { b -> Triple(a.s, b.s, a.dist + b.dist) } }
        .sortedBy { it.third }
        .map { it.first to it.second }
}

/** The nearest foot of each pass the stroke makes by ([x], [y]), nearest first, a few at most. */
private fun footCandidates(corridor: PreparedCorridor, x: Double, y: Double, maxDist: Double): List<Projection> {
    val pts = corridor.pts
    val out = mutableListOf<Projection>()
    var best: Projection? = null
    var rising = false
    for (i in 0 until pts.size - 1) {
        val ax = pts[i].x
        val ay = pts[i].y
        val dx = pts[i + 1].x - ax
        val dy = pts[i + 1].y - ay
        val lenSq = dx * dx + dy * dy
        val t = if (lenSq > 0) (((x - ax) * dx + (y - ay) * dy) / lenSq).coerceIn(0.0, 1.0) else 0.0
        val dist = hypot(x - (ax + t * dx), y - (ay + t * dy))
        val s = corridor.cums[i] + t * sqrt(lenSq)
        val current = best
        if (current == null || dist < current.dist) {
            best = Projection(dist, s)
            rising = false
        } else if (dist > current.dist) {
            // Approaching, now receding: the last minimum was this pass's foot.
            if (!rising && current.dist <= maxDist) out += current
            rising = true
            best = Projection(dist, s)
        }
    }
    best?.let { if (!rising && it.dist <= maxDist) out += it }
    return out.sortedBy { it.dist }.take(MAX_FEET_PER_STOP)
}

private const val MAX_FEET_PER_STOP = 4

/** Half a stroke: the two passes of a doubling-back stroke, not a foot round a corner (TJ:14). */
private const val ALTERNATIVE_FOOT_SLACK_WORLD = 12.5
