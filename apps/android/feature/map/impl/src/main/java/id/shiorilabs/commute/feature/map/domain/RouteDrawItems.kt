package id.shiorilabs.commute.feature.map.domain

import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sign
import kotlin.math.sin
import kotlin.math.tan

/*
 * A drawn route's paint, the route half of the web's `map-renderer.ts`: its sizes, the walk's
 * octilinear path, rounded corners and dots, and the overlay flattened into capsules in paint
 * order. World units throughout, so the route stays glued to the map at every zoom.
 */

/** Over the artwork's 12.5 rail half-width, or the route doesn't read over its own line. */
const val ROUTE_LINE_HALF_WIDTH_WORLD = 16.0

/** BRT is drawn at 15, not 25, so its line scales by the same 15/25. */
const val ROUTE_LINE_HALF_WIDTH_BRT_WORLD = 10.0
const val ROUTE_CASING_EXTRA_WORLD = 3.0

/** A walk's dots: lighter than a ride, the gaps open at a fitted zoom. */
const val ROUTE_TRANSFER_DOT_RADIUS_WORLD = 7.0
const val ROUTE_TRANSFER_DOT_SPACING_WORLD = 26.0
const val ROUTE_PIN_RADIUS_WORLD = 26.0

/** A stop's outer disc beats the line's half-width, so its coloured rim shows; BRT's by 15/25. */
const val ROUTE_STOP_RADIUS_WORLD = 20.0
const val ROUTE_STOP_RADIUS_BRT_WORLD = 13.0

/** How much the map fades toward white and drains of colour while a route is drawn. */
const val ROUTE_FADE_MAX = 0.6
const val ROUTE_DESATURATE_MAX = 0.25

/** The ends' navy, the web's route scrim colour. */
private val ROUTE_INK = Rgb(0.06, 0.09, 0.16)
private val ROUTE_WHITE = Rgb(1.0, 1.0, 1.0)
private const val ROUTE_PIN_INNER_WORLD = 17.0
private const val ROUTE_STOP_INNER_RATIO = 0.5

/** The end pins' arrow: its box's half-height and half-width, and its strokes' half-width. */
private const val ROUTE_ARROW_HALF_H = 11.0
private const val ROUTE_ARROW_HALF_W = 8.0
private const val ROUTE_ARROW_HALF_WIDTH_WORLD = 2.6

enum class RouteSegmentKind { RIDE, TRANSFER }

/** A capsule of the route, [r] its half-width; a walk's dot is one of zero length. */
data class RouteSegment(
    val ax: Double,
    val ay: Double,
    val bx: Double,
    val by: Double,
    val r: Double,
    val color: Rgb,
    val kind: RouteSegmentKind,
)

enum class RoutePinKind { ORIGIN, DESTINATION, STOP }

/**
 * A marker on the route: an end, or a stop in the [color] of the line ridden through it, its outer
 * disc [r] (the rail size when null).
 */
data class RoutePin(
    val x: Double,
    val y: Double,
    val kind: RoutePinKind,
    val color: Rgb? = null,
    val r: Double? = null,
)

data class RouteOverlay(val segments: List<RouteSegment>, val pins: List<RoutePin>)

/** One capsule of the paint list, degenerate (a == b) for a disc. */
data class RouteDrawItem(val ax: Double, val ay: Double, val bx: Double, val by: Double, val r: Double, val color: Rgb)

/**
 * [route] in paint order: a white casing under every segment, then the fills, then the stops,
 * then the ends over any stop they land on, each a white-cased disc with a white core, the ends
 * with an arrow through it: up where the journey starts, down where it ends.
 */
fun routeDrawItems(route: RouteOverlay): List<RouteDrawItem> {
    val items = mutableListOf<RouteDrawItem>()
    for (s in route.segments) items += RouteDrawItem(s.ax, s.ay, s.bx, s.by, s.r + ROUTE_CASING_EXTRA_WORLD, ROUTE_WHITE)
    for (s in route.segments) items += RouteDrawItem(s.ax, s.ay, s.bx, s.by, s.r, s.color)
    fun RoutePin.disc(r: Double, color: Rgb) {
        items += RouteDrawItem(x, y, x, y, r, color)
    }
    for (pin in route.pins) {
        if (pin.kind != RoutePinKind.STOP) continue
        val radius = pin.r ?: ROUTE_STOP_RADIUS_WORLD
        pin.disc(radius + ROUTE_CASING_EXTRA_WORLD, ROUTE_WHITE)
        pin.disc(radius, pin.color ?: ROUTE_INK)
        pin.disc(radius * ROUTE_STOP_INNER_RATIO, ROUTE_WHITE)
    }
    for (pin in route.pins) {
        if (pin.kind == RoutePinKind.STOP) continue
        pin.disc(ROUTE_PIN_RADIUS_WORLD + ROUTE_CASING_EXTRA_WORLD, ROUTE_WHITE)
        pin.disc(ROUTE_PIN_RADIUS_WORLD, pin.color ?: ROUTE_INK)
        pin.disc(ROUTE_PIN_INNER_WORLD, ROUTE_WHITE)
        pushArrow(items, pin.x, pin.y, up = pin.kind == RoutePinKind.ORIGIN, color = pin.color ?: ROUTE_INK)
    }
    return items
}

/** An arrow as three capsules, a shaft and two barbs meeting at the tip; y grows down. */
private fun pushArrow(items: MutableList<RouteDrawItem>, cx: Double, cy: Double, up: Boolean, color: Rgb) {
    val sign = if (up) -1.0 else 1.0
    val tipY = cy + sign * ROUTE_ARROW_HALF_H
    val tailY = cy - sign * ROUTE_ARROW_HALF_H
    fun stroke(ax: Double, ay: Double, bx: Double, by: Double) {
        items += RouteDrawItem(ax, ay, bx, by, ROUTE_ARROW_HALF_WIDTH_WORLD, color)
    }
    stroke(cx, tailY, cx, tipY)
    val barbY = tipY - sign * ROUTE_ARROW_HALF_W
    stroke(cx - ROUTE_ARROW_HALF_W, barbY, cx, tipY)
    stroke(cx + ROUTE_ARROW_HALF_W, barbY, cx, tipY)
}

/** The artwork's connectors bulge ~60 out and turn on ~60 radius corners; a walk borrows both. */
private const val WALK_BULGE_WORLD = 60.0
const val WALK_CORNER_RADIUS_WORLD = 60.0
private const val WALK_CORNER_SAMPLES = 12

/** Within this of horizontal, vertical or 45° a walk is straight: drawn ones sit under 1.49 or over 2.08. */
const val WALK_STRAIGHT_TOLERANCE_DEG = 2.0

/** How far ([dx], [dy]) is off the nearest multiple of 45°, 0..22.5. */
fun octilinearDeviationDeg(dx: Double, dy: Double): Double {
    val angle = ((atan2(dy, dx) * 180 / PI + 360) % 45)
    return min(angle, 45 - angle)
}

/**
 * A walk's path in the schematic's grammar: one straight line when near an axis or 45°, else a
 * diagonal out of its station and a straight run square into the next. [bulgeSide], a world-axis
 * sign across the walk (+1 right of a vertical walk, below a horizontal one), asks a straight
 * near-axis walk to bulge out around a ridden line instead, as the artwork's connectors do.
 */
fun octilinearPath(ax: Double, ay: Double, bx: Double, by: Double, bulgeSide: Int? = null): List<WorldPoint> {
    val dx = bx - ax
    val dy = by - ay
    if (dx == 0.0 && dy == 0.0) return listOf(WorldPoint(ax, ay), WorldPoint(bx, by))
    val horizontal = abs(dx) > abs(dy)
    // In (major, lateral), mapped back, so one body covers both orientations.
    val major = if (horizontal) dx else dy
    val lateral = if (horizontal) dy else dx
    fun toWorld(m: Double, l: Double): WorldPoint =
        if (horizontal) WorldPoint(ax + sign(major) * m, ay + l) else WorldPoint(ax + l, ay + sign(major) * m)
    val length = abs(major)
    val offset = abs(lateral)
    if (octilinearDeviationDeg(dx, dy) >= WALK_STRAIGHT_TOLERANCE_DEG) {
        return listOf(WorldPoint(ax, ay), toWorld(offset, lateral), WorldPoint(bx, by))
    }
    // Only a near-axis walk can bulge; a near-45° one stays a chord.
    val nearAxis = offset < length / 2
    val depth = min(WALK_BULGE_WORLD, (length - offset) / 2)
    if (bulgeSide == null || !nearAxis || depth < 1) return listOf(WorldPoint(ax, ay), WorldPoint(bx, by))
    // Built going down or right, so a walk and its reverse are the same line.
    if (major < 0) return octilinearPath(bx, by, ax, ay, bulgeSide).asReversed()
    val back = abs(lateral - bulgeSide * depth)
    val path = mutableListOf(WorldPoint(ax, ay), toWorld(depth, bulgeSide * depth))
    if (length - back > depth) path += toWorld(length - back, bulgeSide * depth)
    path += WorldPoint(bx, by)
    return path
}

/**
 * [pts] with every interior corner rounded to [radius], as the artwork turns its lines; a corner
 * takes at most half of either run, so two sharing one meet in its middle.
 */
fun roundCorners(pts: List<WorldPoint>, radius: Double): List<WorldPoint> {
    if (pts.size < 3) return pts.toList()
    val out = mutableListOf(pts.first())
    for (i in 1 until pts.size - 1) {
        val (px, py) = pts[i - 1]
        val (cx, cy) = pts[i]
        val (nx, ny) = pts[i + 1]
        val inLen = hypot(cx - px, cy - py)
        val outLen = hypot(nx - cx, ny - cy)
        if (inLen == 0.0 || outLen == 0.0) continue
        val ux = (cx - px) / inLen
        val uy = (cy - py) / inLen
        val vx = (nx - cx) / outLen
        val vy = (ny - cy) / outLen
        val cross = ux * vy - uy * vx
        val dot = ux * vx + uy * vy
        val turn = atan2(abs(cross), dot)
        if (turn < 1e-6) {
            out += pts[i]
            continue
        }
        val half = tan(turn / 2)
        val tangent = minOf(radius * half, inLen / 2, outLen / 2)
        val r = tangent / half
        // From where the inbound run stops, round a centre one radius inside the turn.
        val sx = cx - ux * tangent
        val sy = cy - uy * tangent
        val side = if (cross > 0) 1.0 else -1.0
        val ox = sx - uy * r * side
        val oy = sy + ux * r * side
        val start = atan2(sy - oy, sx - ox)
        for (k in 0..WALK_CORNER_SAMPLES) {
            val a = start + side * turn * (k.toDouble() / WALK_CORNER_SAMPLES)
            out += WorldPoint(ox + cos(a) * r, oy + sin(a) * r)
        }
    }
    out += pts.last()
    return out
}

/**
 * Dots along [pts] every [spacing] by arc length, stretched a little so both ends get one; a path
 * shorter than one interval still gets its two.
 */
fun dotPolyline(pts: List<WorldPoint>, spacing: Double): List<WorldPoint> {
    val lengths = DoubleArray(max(0, pts.size - 1)) { i -> hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y) }
    val total = lengths.sum()
    if (total <= 0) return emptyList()
    // Half up, as JavaScript's Math.round.
    val intervals = max(1L, Math.round(total / spacing)).toInt()
    val dots = ArrayList<WorldPoint>(intervals + 1)
    var seg = 0
    var segStart = 0.0
    for (k in 0..intervals) {
        val s = total * k / intervals
        while (seg < lengths.size - 1 && s > segStart + lengths[seg]) {
            segStart += lengths[seg]
            seg++
        }
        val t = if (lengths[seg] > 0) min(1.0, (s - segStart) / lengths[seg]) else 0.0
        val (x0, y0) = pts[seg]
        val (x1, y1) = pts[seg + 1]
        dots += WorldPoint(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t)
    }
    return dots
}
