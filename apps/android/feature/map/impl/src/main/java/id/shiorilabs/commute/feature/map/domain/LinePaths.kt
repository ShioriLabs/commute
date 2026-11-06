package id.shiorilabs.commute.feature.map.domain

import kotlin.math.abs
import kotlin.math.hypot

/*
 * A ride's geometry read off the traced lines, the web's `map-line-path.ts`. The corridors are the
 * raw artwork, which knows colour and width but not which line it is; `map-lines.json` is keyed by
 * line, as a ride names its own, so for a traced line the answer is a lookup. Where each station
 * sits along its stroke isn't recorded, so it is recovered by projecting the station onto it.
 */

/**
 * How far a station may sit from its own traced stroke and still be sliced from it. Over the
 * shipped network the median is 2.6; past 60 are the lines whose traces have holes (TJ:10D's gap
 * stations project ~2000 away), and those pairs fall back to the corridor matcher.
 */
const val TRACED_PATH_MAX_OFFSET_WORLD = 60.0

/** A joint wider than this is a real break in the stroke: noise is ≤ 0.29, breaks ≥ 282. */
private const val STROKE_JOINT_TOLERANCE_WORLD = 1.0

/** A station on a traced stroke: its arc length [s] along it, and how far off it it sits. */
class TracedStop(val id: String, var s: Double, val dist: Double)

/**
 * One unbroken run of a traced segment, and where each of its stations lands on it, parallel to
 * the segment's markers: a loop repeats its first station last, at a different arc length.
 */
class PreparedSegment(val stroke: PreparedCorridor, val stops: List<TracedStop?>)

/** Every traced line's runs by key, `OPERATOR:CODE`. */
class PreparedLinePaths(val segments: Map<String, List<PreparedSegment>>)

/** Projects every traced line's stations onto its own stroke, once for the whole network. */
fun prepareLinePaths(lines: List<MapLine>, points: List<MapPoint>): PreparedLinePaths {
    // An exact id beats a twice-drawn halte's alias, as everywhere the tap targets are resolved.
    val byStation = HashMap<String, MapPoint>()
    for (point in points) {
        val stationId = point.stationId
        if (point.id == stationId || stationId !in byStation) byStation[stationId] = point
    }

    val segments = HashMap<String, List<PreparedSegment>>()
    for (line in lines) {
        val prepared = mutableListOf<PreparedSegment>()
        for (segment in line.segments) {
            // A broken segment becomes several strokes: a pair within one still slices, and only
            // a pair spanning the break is refused (TJ:4's trunk breaks 486 at edge 29 of 41).
            for (pts in strokesOf(segment.edges)) {
                if (pts.size < 2) continue
                val stroke = PreparedCorridor(pts, line.color, line.r * 2)
                // A station beyond the break projects onto this run's end, far off it, and fails
                // the offset gate here while passing on the run that draws it.
                val stops = segment.markers.map { id ->
                    byStation[id]?.let { point ->
                        val (dist, s) = projectOntoPolyline(point.centerX, point.centerY, stroke)
                        TracedStop(id, s, dist)
                    }
                }
                resolveLoopWrap(stroke, stops)
                prepared += PreparedSegment(stroke, stops)
            }
        }
        if (prepared.isNotEmpty()) segments[line.key] = prepared
    }
    return PreparedLinePaths(segments)
}

/**
 * Puts a ring's closing station at the end of its stroke. Opening and closing station project to
 * the same foot, which the projection resolves to the lower arc length, so the closing leg would
 * slice backwards round the whole ring. Only that marker moves: sweeping every stop that fell
 * behind cascades from the first stop's 0 and collapses the loop.
 */
private fun resolveLoopWrap(stroke: PreparedCorridor, stops: List<TracedStop?>) {
    val total = stroke.length
    if (total <= 0) return
    val start = stroke.pts.first()
    val end = stroke.pts.last()
    if (hypot(end.x - start.x, end.y - start.y) > STROKE_JOINT_TOLERANCE_WORLD) return
    val first = stops.firstOrNull() ?: return
    val last = stops.lastOrNull() ?: return
    if (first === last || first.id != last.id) return
    if (last.s <= first.s) last.s = total
}

/** The traced edges as unbroken runs, already in ride order. */
private fun strokesOf(edges: List<List<Double>>): List<List<WorldPoint>> {
    val runs = mutableListOf<List<WorldPoint>>()
    var current = mutableListOf<WorldPoint>()
    for ((ax, ay, bx, by) in edges) {
        if (current.isEmpty()) {
            current += WorldPoint(ax, ay)
        } else {
            val previous = current.last()
            if (hypot(ax - previous.x, ay - previous.y) > STROKE_JOINT_TOLERANCE_WORLD) {
                runs += current
                current = mutableListOf(WorldPoint(ax, ay))
            }
        }
        current += WorldPoint(bx, by)
    }
    if (current.isNotEmpty()) runs += current
    return runs
}

/**
 * The stretch of [lineKey]'s traced stroke from station [fromId] to [toId], in travel order; null
 * when the trace can't answer for the pair (an untraced line, a station off its stroke, a hole),
 * for the corridor matcher's better-informed guess.
 */
fun sliceLinePath(prepared: PreparedLinePaths?, lineKey: String?, fromId: String, toId: String): List<WorldPoint>? {
    if (prepared == null || lineKey == null) return null
    val segments = prepared.segments[lineKey] ?: return null
    val (segment, from, to) = pickSegment(segments, fromId, toId) ?: return null
    return extractSubPolyline(segment.stroke, from.s, to.s).takeIf { it.size >= 2 }
}

/**
 * The run that rides this pair. A branch shares its junction with the trunk, so markers adjacent
 * in a run's list (the tracer walked through the pair) win outright; failing that, the shortest
 * span along the stroke.
 */
private fun pickSegment(
    segments: List<PreparedSegment>,
    fromId: String,
    toId: String,
): Triple<PreparedSegment, TracedStop, TracedStop>? {
    var best: Triple<PreparedSegment, TracedStop, TracedStop>? = null
    var bestSpan = Double.POSITIVE_INFINITY
    var bestAdjacent = false
    for (segment in segments) {
        val stops = segment.stops
        for (i in stops.indices) {
            val from = stops[i]
            if (from == null || from.id != fromId || from.dist > TRACED_PATH_MAX_OFFSET_WORLD) continue
            for (j in stops.indices) {
                if (i == j) continue
                val to = stops[j]
                if (to == null || to.id != toId || to.dist > TRACED_PATH_MAX_OFFSET_WORLD) continue
                val span = abs(to.s - from.s)
                val adjacent = abs(i - j) == 1
                if (best == null || (adjacent && !bestAdjacent) || (adjacent == bestAdjacent && span < bestSpan)) {
                    best = Triple(segment, from, to)
                    bestSpan = span
                    bestAdjacent = adjacent
                }
            }
        }
    }
    return best
}
