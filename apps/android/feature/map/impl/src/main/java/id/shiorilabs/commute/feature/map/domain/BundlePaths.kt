package id.shiorilabs.commute.feature.map.domain

import id.shiorilabs.commute.core.geo.GeoPoint
import id.shiorilabs.commute.core.geo.decodePolyline
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow

/**
 * A line drawn as one through the network: its edges chained end to end, each [BundlePiece] its way
 * along one edge at its place across that edge's bundle. Drawn so, a line turning or moving over at
 * a node bends on through it, rather than ending on one edge and starting again beside itself on
 * the next (the A and T swapping sides at Duri, the corners of the Galunggung loop).
 */
data class BundlePath(
    val code: String,
    val color: String,
    val kind: String,
    /** Its width in bus line widths: [RAIL_LINE_WEIGHT] for a rail line. */
    val weight: Double,
    val pieces: List<BundlePiece>,
)

/**
 * A line's way along one edge, [slot] line widths right of the way it goes. Each starts where the
 * one before ends. A [lead] runs along the edge a branch peels off from, under the line's own path
 * there, so the branch eases out of its place in the bundle rather than starting beside it.
 */
data class BundlePiece(val points: List<GeoPoint>, val slot: Double, val lead: Boolean = false)

/**
 * Every drawn line's [BundlePath]s: its edges, each at its stroke's place ([strokesOf], the bundle's
 * shift with it), chained through the nodes. Where a line's edges meet three or more at a node (a
 * branch, a one-way pair parting), each goes on along the straightest; the rest start paths of their own.
 */
fun BusMap.bundlePaths(): List<BundlePath> {
    val byCode = lines.associateBy { it.code }
    class End(val edge: Int, val atStart: Boolean)
    class Laid(val points: List<GeoPoint>, val slot: Double)
    val out = mutableListOf<BundlePath>()
    // Each line's edges and its place on each, by line.
    val laidOf = LinkedHashMap<String, MutableList<Laid>>()
    val weightOf = HashMap<String, Double>()
    val kindOf = HashMap<String, String>()
    for (edge in edges) {
        val points = decodePolyline(edge.shape).let { p -> p.filterIndexed { i, q -> i == 0 || q != p[i - 1] } }
        if (points.size < 2) continue
        for (stroke in strokesOf(edge, byCode)) {
            for (code in stroke.codes) {
                laidOf.getOrPut(code) { mutableListOf() } += Laid(points, stroke.slot)
                weightOf[code] = stroke.weight
                kindOf[code] = stroke.kind
            }
        }
    }
    val first = laidOf.values.firstOrNull()?.firstOrNull()?.points?.firstOrNull() ?: return emptyList()
    val kx = M_PER_DEG_LAT * cos(Math.toRadians(first.latitude))
    fun key(p: GeoPoint) = "${(p.latitude * 1e6).toLong()},${(p.longitude * 1e6).toLong()}"

    for ((code, laid) in laidOf) {
        val line = byCode[code] ?: continue
        val ends = HashMap<String, MutableList<End>>()
        laid.forEachIndexed { i, l ->
            ends.getOrPut(key(l.points.first())) { mutableListOf() } += End(i, true)
            ends.getOrPut(key(l.points.last())) { mutableListOf() } += End(i, false)
        }
        // The way an end leaves its node, over its first [HEADING_M].
        fun leaving(end: End): Pair<Double, Double> {
            val pts = laid[end.edge].points.let { if (end.atStart) it else it.asReversed() }
            val a = pts.first()
            val b = pts.firstOrNull { hypot((it.longitude - a.longitude) * kx, (it.latitude - a.latitude) * M_PER_DEG_LAT) >= HEADING_M } ?: pts.last()
            val dx = (b.longitude - a.longitude) * kx
            val dy = (b.latitude - a.latitude) * M_PER_DEG_LAT
            val d = hypot(dx, dy).takeIf { it > 0 } ?: 1.0
            return dx / d to dy / d
        }
        // At each node, ends paired straightest first: the one going on from each.
        val next = HashMap<Pair<Int, Boolean>, End>()
        for (here in ends.values) {
            if (here.size < 2) continue
            val ways = here.map(::leaving)
            val pairs = mutableListOf<Triple<Int, Int, Double>>()
            for (i in here.indices) for (j in i + 1 until here.size) {
                if (here[i].edge == here[j].edge && here.size > 2) continue
                pairs += Triple(i, j, ways[i].first * ways[j].first + ways[i].second * ways[j].second)
            }
            val used = BooleanArray(here.size)
            for ((i, j, _) in pairs.sortedBy { it.third }) {
                if (used[i] || used[j]) continue
                used[i] = true
                used[j] = true
                next[here[i].edge to here[i].atStart] = here[j]
                next[here[j].edge to here[j].atStart] = here[i]
            }
        }
        // Walk each path from an end going on to nothing, then whatever is left round a loop.
        val walked = BooleanArray(laid.size)
        // The end a walk last left by: where the path it made ends.
        var lastEnd: End? = null
        fun walk(from: End): List<BundlePiece> {
            val pieces = mutableListOf<BundlePiece>()
            var at: End? = from
            lastEnd = null
            while (at != null && !walked[at.edge]) {
                walked[at.edge] = true
                val l = laid[at.edge]
                // Entered at its start, it runs its own way; at its end, backwards, its right the other side.
                pieces += if (at.atStart) BundlePiece(l.points, l.slot) else BundlePiece(l.points.asReversed(), -l.slot)
                lastEnd = End(at.edge, !at.atStart)
                at = next[at.edge to !at.atStart]
            }
            return pieces
        }
        // A path ending at a node its line goes on from (a branch: A west at Duri, A south going on),
        // led along the way it goes on, the straightest, up to [LEAD_M].
        fun along(points: List<GeoPoint>, fromEnd: Boolean): List<GeoPoint> {
            val pts = if (fromEnd) points.asReversed() else points
            val kept = mutableListOf(pts.first())
            var m = 0.0
            for (q in pts.drop(1)) {
                val a = kept.last()
                m += hypot((q.longitude - a.longitude) * kx, (q.latitude - a.latitude) * M_PER_DEG_LAT)
                kept += q
                if (m >= LEAD_M) break
            }
            return if (fromEnd) kept.asReversed() else kept
        }
        fun lead(end: End, into: Boolean): BundlePiece? {
            val node = laid[end.edge].points.let { if (end.atStart) it.first() else it.last() }
            val way = leaving(end)
            val on = ends[key(node)].orEmpty()
                .filter { it.edge != end.edge || it.atStart != end.atStart }
                .minByOrNull { c -> leaving(c).let { it.first * way.first + it.second * way.second } } ?: return null
            val l = laid[on.edge]
            // Into the node along it (before a path's start), or out of the node along it (after its end).
            return if (into) {
                if (on.atStart) BundlePiece(along(l.points, fromEnd = false).asReversed(), -l.slot, lead = true)
                else BundlePiece(along(l.points, fromEnd = true), l.slot, lead = true)
            } else {
                if (on.atStart) BundlePiece(along(l.points, fromEnd = false), l.slot, lead = true)
                else BundlePiece(along(l.points, fromEnd = true).asReversed(), -l.slot, lead = true)
            }
        }
        fun path(from: End): BundlePath {
            val pieces = walk(from).toMutableList()
            val last = lastEnd
            lead(from, into = true)?.let { pieces.add(0, it) }
            if (last != null) lead(last, into = false)?.let { pieces += it }
            return BundlePath(code, line.color, kindOf[code] ?: line.kind, weightOf[code] ?: 1.0, pieces)
        }
        val starts = laid.indices.flatMap { i -> listOf(End(i, true), End(i, false)) }.filter { (it.edge to it.atStart) !in next }
        for (start in starts) {
            if (walked[start.edge]) continue
            out += path(start)
        }
        for (i in laid.indices) {
            if (!walked[i]) out += BundlePath(code, line.color, kindOf[code] ?: line.kind, weightOf[code] ?: 1.0, walk(End(i, true)))
        }
    }
    return out
}

/** A zoom band the paths are drawn for: from [from] up to [to], their offsets baked for its middle. */
data class BundleBand(val index: Int, val from: Double, val to: Double)

/** The bands, every [BAND_STEP] from [BAND_FIRST] to [BAND_LAST], the first reaching all the way out. */
val BUNDLE_BANDS: List<BundleBand> = run {
    val count = ((BAND_LAST - BAND_FIRST) / BAND_STEP).toInt()
    (0 until count).map { i ->
        val from = BAND_FIRST + i * BAND_STEP
        BundleBand(i, if (i == 0) 0.0 else from, from + BAND_STEP)
    }
}

/**
 * A line's width in dp at zoom [z], as the streets layer draws the bundles: [BUS_LINE_W_15_DP] at
 * z15, between its other stops along the way. A stretch's offset is its slot times this.
 */
fun bundleLineWidth(z: Double): Double {
    val stops = LINE_WIDTH_STOPS
    if (z <= stops.first().first) return stops.first().second
    for (i in 1 until stops.size) {
        val (z1, w1) = stops[i]
        val (z0, w0) = stops[i - 1]
        if (z <= z1) return w0 + (w1 - w0) * (z - z0) / (z1 - z0)
    }
    return stops.last().second
}

/** Zoom → a line's width in dp, the stops the streets layer interpolates between. */
val LINE_WIDTH_STOPS: List<Pair<Double, Double>> = listOf(10.0 to 1.0, 13.0 to 2.0, 15.0 to BUS_LINE_W_15_DP.toDouble(), 18.0 to 6.0)

/**
 * [path] at [band]'s zoom with its offset baked in: each point moved its slot times the line width
 * there ([bundleLineWidth], [heavier] times as heavy) right of its way, in metres at that zoom; its
 * place smoothed along the way so it eases over where it moves ([EASE_WIDTHS]); simplified to
 * [SIMPLIFY_PX].
 */
fun offsetBundlePath(path: BundlePath, band: BundleBand, heavier: Double = 1.0): List<GeoPoint> {
    val pieces = path.pieces.filter { it.points.size >= 2 }
    if (pieces.isEmpty()) return emptyList()
    val lat0 = pieces.first().points.first().latitude
    val kx = M_PER_DEG_LAT * cos(Math.toRadians(lat0))
    val z = (band.from.coerceAtLeast(BAND_FIRST) + band.to) / 2
    val metresPerDp = EARTH_CIRCUMFERENCE_M * cos(Math.toRadians(lat0)) / (TILE_DP * 2.0.pow(z))
    val unit = bundleLineWidth(z) * heavier * metresPerDp

    // The path in metres, each point with the distance along it; each piece's end there.
    val xs = ArrayList<Double>()
    val ys = ArrayList<Double>()
    val along = ArrayList<Double>()
    val pieceEnd = DoubleArray(pieces.size)
    // Zoomed out, each edge straightened first (straightenDp): every line on it alike, so they stay
    // side by side, and its ends kept, so they still meet at the nodes.
    val straightenM = straightenDp(z) * heavier * metresPerDp
    for ((p, piece) in pieces.withIndex()) {
        for ((i, q) in straightened(piece.points, kx, straightenM).withIndex()) {
            val x = q.longitude * kx
            val y = q.latitude * M_PER_DEG_LAT
            if (xs.isNotEmpty() && (p > 0 && i == 0 || abs(x - xs.last()) + abs(y - ys.last()) < 1e-6)) continue
            along += if (xs.isEmpty()) 0.0 else along.last() + hypot(x - xs.last(), y - ys.last())
            xs += x
            ys += y
        }
        pieceEnd[p] = along.last()
    }
    if (xs.size < 2) return emptyList()
    roundCorners(xs, ys, along, FILLET_WIDTHS * unit)

    // Its place along the way, piece by piece, smoothed: a moving average [EASE_WIDTHS] line widths
    // long, taken twice, so a line moving over eases across, however short the edges there, and two
    // moves close together blend into one. Laid on a grid along it, a quarter width apart.
    val total = along.last()
    val step = max(unit / 4, 0.5)
    val cells = (total / step).toInt() + 1
    fun stepSlot(d: Double): Double {
        for (p in pieces.indices) if (d < pieceEnd[p]) return pieces[p].slot
        return pieces.last().slot
    }
    val raw = DoubleArray(cells + 1) { k -> stepSlot(k * step) }
    fun boxed(values: DoubleArray, half: Int): DoubleArray {
        if (half <= 0) return values
        val sums = DoubleArray(values.size + 1)
        for (k in values.indices) sums[k + 1] = sums[k] + values[k]
        return DoubleArray(values.size) { k ->
            // Past either end, the end's own place held on.
            val lo = k - half
            val hi = k + half
            var sum = sums[min(hi, values.lastIndex) + 1] - sums[max(lo, 0)]
            if (lo < 0) sum += -lo * values.first()
            if (hi > values.lastIndex) sum += (hi - values.lastIndex) * values.last()
            sum / (2 * half + 1)
        }
    }
    val half = (EASE_WIDTHS * unit / 2 / 2 / step).toInt()
    val smooth = boxed(boxed(raw, half), half)
    fun slotAt(d: Double): Double {
        val k = (d / step).coerceIn(0.0, cells.toDouble())
        val i = k.toInt().coerceAtMost(cells - 1).coerceAtLeast(0)
        val t = k - i
        return smooth[i] + (smooth[min(i + 1, cells)] - smooth[i]) * t
    }

    // The points again, with the grid's laid in where its place is moving, each with its slot.
    fun pointAt(d: Double): DoubleArray {
        val i = along.binarySearch(d).let { if (it >= 0) it else -it - 2 }.coerceIn(0, along.size - 2)
        val t = if (along[i + 1] > along[i]) (d - along[i]) / (along[i + 1] - along[i]) else 0.0
        return doubleArrayOf(xs[i] + (xs[i + 1] - xs[i]) * t, ys[i] + (ys[i + 1] - ys[i]) * t, d)
    }
    val moving = (0 until cells).filter { k -> abs(smooth[min(k + 1, cells)] - smooth[k]) > 1e-9 }.map { it * step }
    val dense = ArrayList<DoubleArray>()
    for (d in (along + moving).filter { it in 0.0..total }.sorted()) {
        if (dense.isNotEmpty() && d - dense.last()[2] < 0.05) continue
        dense += pointAt(d)
    }
    val slots = dense.map { slotAt(it[2]) }

    // Each point moved right of its way: the two legs' normals between, held to a miter of 2.
    val out = ArrayList<DoubleArray>(dense.size)
    for (i in dense.indices) {
        var nx = 0.0
        var ny = 0.0
        val legs = mutableListOf<Pair<Double, Double>>()
        if (i > 0) legs += (dense[i][0] - dense[i - 1][0]) to (dense[i][1] - dense[i - 1][1])
        if (i < dense.lastIndex) legs += (dense[i + 1][0] - dense[i][0]) to (dense[i + 1][1] - dense[i][1])
        val units = legs.mapNotNull { (dx, dy) -> hypot(dx, dy).takeIf { it > 0 }?.let { dx / it to dy / it } }
        // Right of a way (dx, dy), north up: (dy, -dx).
        for ((ux, uy) in units) {
            nx += uy
            ny += -ux
        }
        val n = hypot(nx, ny)
        if (n == 0.0) {
            out += doubleArrayOf(dense[i][0], dense[i][1])
            continue
        }
        nx /= n
        ny /= n
        val cosHalf = units.firstOrNull()?.let { (ux, uy) -> uy * nx - ux * ny } ?: 1.0
        val miter = 1 / max(cosHalf, 0.5)
        val o = slots[i] * unit * miter
        out += doubleArrayOf(dense[i][0] + nx * o, dense[i][1] + ny * o)
    }
    val smoothed = smoothXY(cutLoops(out, LOOP_WIDTHS * unit), SMOOTH_WIDTHS * unit, max(unit / 4, 0.5))
    return simplifyXY(smoothed, SIMPLIFY_PX * metresPerDp).map { GeoPoint(it[1] / M_PER_DEG_LAT, it[0] / kx) }
}

/**
 * [pts] laid every [step] metres along and smoothed over about [spanM] (a moving average taken
 * twice), its ends where they were: a hook or lobe smaller than the line is wide (A turning up into
 * the Duri bundle, U-ing past the node first) is noise at the zoom it's drawn for, and lines side by
 * side smoothed alike stay side by side.
 */
private fun smoothXY(pts: List<DoubleArray>, spanM: Double, step: Double): List<DoubleArray> {
    if (pts.size < 3 || spanM <= 0) return pts
    val d = DoubleArray(pts.size)
    for (i in 1 until pts.size) d[i] = d[i - 1] + hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])
    val total = d.last()
    val n = (total / step).toInt()
    if (n < 3) return pts
    val xs = DoubleArray(n + 1)
    val ys = DoubleArray(n + 1)
    var j = 0
    for (k in 0..n) {
        val at = if (k == n) total else k * step
        while (j < pts.size - 2 && d[j + 1] < at) j++
        val t = if (d[j + 1] > d[j]) ((at - d[j]) / (d[j + 1] - d[j])).coerceIn(0.0, 1.0) else 0.0
        xs[k] = pts[j][0] + (pts[j + 1][0] - pts[j][0]) * t
        ys[k] = pts[j][1] + (pts[j + 1][1] - pts[j][1]) * t
    }
    val half = (spanM / 4 / step).toInt()
    if (half < 1) return pts
    fun boxed(v: DoubleArray): DoubleArray {
        val sums = DoubleArray(v.size + 1)
        for (k in v.indices) sums[k + 1] = sums[k] + v[k]
        return DoubleArray(v.size) { k ->
            // Near an end, the window narrowed to fit, so the end stays put.
            val h = min(half, min(k, v.lastIndex - k))
            (sums[k + h + 1] - sums[k - h]) / (2 * h + 1)
        }
    }
    val sx = boxed(boxed(xs))
    val sy = boxed(boxed(ys))
    return (0..n).map { doubleArrayOf(sx[it], sy[it]) }
}

/**
 * [pts] with every loop it makes shorter than [maxM] cut out at the crossing: an offset further
 * inside a turn than the turn is round folds back over itself (a swallowtail), and drawn so the fold
 * juts out of the bundle as a stub (A off the Duri bundle west, a width and a half inside a corner
 * rounded 13 m). A route's own loops, a terminus's, run hundreds of metres and are kept.
 */
private fun cutLoops(pts: List<DoubleArray>, maxM: Double): List<DoubleArray> {
    if (pts.size < 4) return pts
    val out = pts.toMutableList()
    var i = 0
    while (i < out.size - 3) {
        // The farthest crossing within reach, so a loop is cut whole.
        var walked = 0.0
        var reach = i + 2
        while (reach < out.size - 1 && walked < maxM) {
            walked += hypot(out[reach][0] - out[reach - 1][0], out[reach][1] - out[reach - 1][1])
            reach++
        }
        var cut = -1
        var at: DoubleArray? = null
        for (j in min(reach, out.size - 2) downTo i + 2) {
            val p = crossing(out[i], out[i + 1], out[j], out[j + 1]) ?: continue
            cut = j
            at = p
            break
        }
        if (cut >= 0 && at != null) {
            repeat(cut - i) { out.removeAt(i + 1) }
            out.add(i + 1, at)
        }
        i++
    }
    return out
}

/** Where segments [a]–[b] and [c]–[d] cross, if they do. */
private fun crossing(a: DoubleArray, b: DoubleArray, c: DoubleArray, d: DoubleArray): DoubleArray? {
    val rx = b[0] - a[0]
    val ry = b[1] - a[1]
    val sx = d[0] - c[0]
    val sy = d[1] - c[1]
    val denom = rx * sy - ry * sx
    if (abs(denom) < 1e-12) return null
    val t = ((c[0] - a[0]) * sy - (c[1] - a[1]) * sx) / denom
    val u = ((c[0] - a[0]) * ry - (c[1] - a[1]) * rx) / denom
    if (t <= 0 || t >= 1 || u <= 0 || u >= 1) return null
    return doubleArrayOf(a[0] + rx * t, a[1] + ry * t)
}

/**
 * The path's ([xs], [ys], metres) corners sharper than [FILLET_MIN_DEG] rounded on an arc [radius]
 * round, as Transit rounds its bundles by their width: lines turning together offset from it turn
 * on arcs side by side, not into one point (A and T west off the Duri bundle). Where a leg is too
 * short, tighter, its tangent at most [FILLET_LEG_SHARE] of either leg. Each point the arc adds
 * keeps the distance [along] the unrounded way at its place, for the places laid along it.
 */
private fun roundCorners(xs: ArrayList<Double>, ys: ArrayList<Double>, along: ArrayList<Double>, radius: Double) {
    if (xs.size < 3) return
    val ox = ArrayList(xs)
    val oy = ArrayList(ys)
    val od = ArrayList(along)
    xs.clear()
    ys.clear()
    along.clear()
    xs += ox[0]
    ys += oy[0]
    along += od[0]
    val minTurn = Math.toRadians(FILLET_MIN_DEG)
    for (i in 1 until ox.lastIndex) {
        val l1 = hypot(ox[i] - ox[i - 1], oy[i] - oy[i - 1])
        val l2 = hypot(ox[i + 1] - ox[i], oy[i + 1] - oy[i])
        if (l1 == 0.0 || l2 == 0.0) continue
        val u1x = (ox[i] - ox[i - 1]) / l1
        val u1y = (oy[i] - oy[i - 1]) / l1
        val u2x = (ox[i + 1] - ox[i]) / l2
        val u2y = (oy[i + 1] - oy[i]) / l2
        val turn = kotlin.math.acos((u1x * u2x + u1y * u2y).coerceIn(-1.0, 1.0))
        val t = min(radius * kotlin.math.tan(turn / 2), FILLET_LEG_SHARE * min(l1, l2))
        if (turn < minTurn || turn > Math.toRadians(FILLET_MAX_DEG) || t < 0.5) {
            xs += ox[i]
            ys += oy[i]
            along += od[i]
            continue
        }
        // A quadratic from the tangent point in, round the corner, to the tangent point out.
        val ax = ox[i] - u1x * t
        val ay = oy[i] - u1y * t
        val bx = ox[i] + u2x * t
        val by = oy[i] + u2y * t
        val steps = max(4, (Math.toDegrees(turn) / FILLET_STEP_DEG).toInt())
        for (k in 0..steps) {
            val s = k.toDouble() / steps
            val r = 1 - s
            xs += r * r * ax + 2 * r * s * ox[i] + s * s * bx
            ys += r * r * ay + 2 * r * s * oy[i] + s * s * by
            along += od[i] - t + 2 * t * s
        }
    }
    xs += ox.last()
    ys += oy.last()
    along += od.last()
}

/**
 * How far, in dp, a street's way may be straightened at zoom [z]: zoomed out a bend in the street
 * isn't read, only the lines' run, as a transit map draws them; [STRAIGHTEN_DP] out to
 * [STRAIGHTEN_FULL_ZOOM], easing to none by [STRAIGHTEN_NONE_ZOOM], where the streets are read.
 * Taken times the lines' weight, so it stays about a line's width and a station's mark still sits
 * on its lines.
 */
fun straightenDp(z: Double): Double = when {
    z <= STRAIGHTEN_FULL_ZOOM -> STRAIGHTEN_DP
    z >= STRAIGHTEN_NONE_ZOOM -> 0.0
    else -> STRAIGHTEN_DP * (STRAIGHTEN_NONE_ZOOM - z) / (STRAIGHTEN_NONE_ZOOM - STRAIGHTEN_FULL_ZOOM)
}

/** [points] straightened to within [toleranceM] (Douglas–Peucker), their ends kept. */
private fun straightened(points: List<GeoPoint>, kx: Double, toleranceM: Double): List<GeoPoint> {
    if (toleranceM <= 0 || points.size < 3) return points
    val xy = points.map { doubleArrayOf(it.longitude * kx, it.latitude * M_PER_DEG_LAT) }
    return simplifyXY(xy, toleranceM).map { GeoPoint(it[1] / M_PER_DEG_LAT, it[0] / kx) }
}

/** Douglas–Peucker over [pts], [tolerance] metres. */
private fun simplifyXY(pts: List<DoubleArray>, tolerance: Double): List<DoubleArray> {
    if (pts.size < 3) return pts
    val keep = BooleanArray(pts.size)
    keep[0] = true
    keep[pts.lastIndex] = true
    val stack = ArrayDeque<Pair<Int, Int>>()
    stack.addLast(0 to pts.lastIndex)
    while (stack.isNotEmpty()) {
        val (a, b) = stack.removeLast()
        if (b - a < 2) continue
        val (ax, ay) = pts[a][0] to pts[a][1]
        val (bx, by) = pts[b][0] to pts[b][1]
        val len = hypot(bx - ax, by - ay)
        var worst = -1.0
        var at = -1
        for (i in a + 1 until b) {
            val d = if (len == 0.0) {
                hypot(pts[i][0] - ax, pts[i][1] - ay)
            } else {
                abs((bx - ax) * (ay - pts[i][1]) - (ax - pts[i][0]) * (by - ay)) / len
            }
            if (d > worst) {
                worst = d
                at = i
            }
        }
        if (worst > tolerance) {
            keep[at] = true
            stack.addLast(a to at)
            stack.addLast(at to b)
        }
    }
    return pts.filterIndexed { i, _ -> keep[i] }
}

private const val M_PER_DEG_LAT = 110_574.0
private const val EARTH_CIRCUMFERENCE_M = 40_075_016.686

/** MapLibre's tiles: 512 dp across at zoom 0. */
private const val TILE_DP = 512.0

/** How far a branch is led along the way its line goes on from where it parts. */
private const val LEAD_M = 300.0

/** How far along an end the way it leaves a node is read. */
private const val HEADING_M = 20.0

/** The bands: half a zoom each, offsets off by under a tenth at their edges, the bundle zooms covered. */
private const val BAND_FIRST = 10.0
private const val BAND_LAST = 16.0
private const val BAND_STEP = 0.5

/** A line moving over eases across about this many line widths, as Transit's do: the smoothing's span. */
private const val EASE_WIDTHS = 4.0

/** A corner's arc, in line widths round: wide enough for a bundle of a few lines to turn on side by side. */
private const val FILLET_WIDTHS = 3.0

/** Corners turning less than this are left (a bend already eased); more than this, a way doubling back, left too. */
private const val FILLET_MIN_DEG = 20.0
private const val FILLET_MAX_DEG = 150.0

/** An arc's tangent takes at most this share of either leg. */
private const val FILLET_LEG_SHARE = 0.45

/** A point on an arc every this many degrees of turn. */
private const val FILLET_STEP_DEG = 10.0

/** A path's own loop shorter than this many line widths is a fold of its offset, cut out. */
private const val LOOP_WIDTHS = 6.0

/** Each path's own way smoothed over about this many line widths: a hook smaller than the line, gone. */
private const val SMOOTH_WIDTHS = 3.0

/** A street straightened up to this many dp zoomed out (straightenDp), and the zooms it eases off over. */
private const val STRAIGHTEN_DP = 2.0
private const val STRAIGHTEN_FULL_ZOOM = 13.0
private const val STRAIGHTEN_NONE_ZOOM = 15.0

/** The paths simplified to this, in dp at their band's zoom. */
private const val SIMPLIFY_PX = 0.3

/**
 * Every path at every band ([offsetBundlePath]) as GeoJSON for the streets layer: a LineString apiece
 * carrying its line's code (its [BusMapProps.LINES] too, for a tap), kind, colour, weight, and
 * [BusMapProps.BAND], the layer drawing it at that band's zooms.
 */
fun bundlePathsGeoJson(paths: List<BundlePath>, heavier: Double = 1.0): String {
    val out = StringBuilder(1 shl 20)
    out.append("""{"type":"FeatureCollection","features":[""")
    var first = true
    for (band in BUNDLE_BANDS) {
        for (path in paths) {
            val points = offsetBundlePath(path, band, heavier)
            if (points.size < 2) continue
            if (!first) out.append(',')
            first = false
            out.append("""{"type":"Feature","geometry":{"type":"LineString","coordinates":[""")
            points.forEachIndexed { i, p ->
                if (i > 0) out.append(',')
                out.append('[').append(round6(p.longitude)).append(',').append(round6(p.latitude)).append(']')
            }
            out.append("""]},"properties":{""")
            out.append('"').append(BusMapProps.CODE).append("\":\"").append(path.code).append("\",")
            out.append('"').append(BusMapProps.LINES).append("\":\"").append(path.code).append("\",")
            out.append('"').append(BusMapProps.KIND).append("\":\"").append(path.kind).append("\",")
            out.append('"').append(BusMapProps.COLOR).append("\":\"").append(path.color).append("\",")
            out.append('"').append(BusMapProps.WEIGHT).append("\":").append(path.weight).append(',')
            out.append('"').append(BusMapProps.BAND).append("\":").append(band.index)
            out.append("}}")
        }
    }
    out.append("]}")
    return out.toString()
}

private fun round6(v: Double): String = String.format(java.util.Locale.ROOT, "%.6f", v)
