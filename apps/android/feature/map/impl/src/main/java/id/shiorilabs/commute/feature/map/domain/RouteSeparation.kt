package id.shiorilabs.commute.feature.map.domain

import id.shiorilabs.commute.core.geo.GeoPoint
import kotlin.math.ceil
import kotlin.math.cos
import kotlin.math.floor
import kotlin.math.hypot

/** A stretch of a line on its own streets, at [slot] line widths right of its way: its place among the lines running with it. */
data class RouteRun(val points: List<GeoPoint>, val slot: Double)

/**
 * Each line's [pieces] cut where the lines running with it change, every stretch given its place
 * across the street among them, as the bundles are: at street zoom the lines stay on their own
 * streets but no longer draw one over another. Lines run together where another goes the same way
 * within [SHARED_M] (laid on the roads, two lines on one lane lie within a metre; the next lane is
 * six off), a bus line with bus lines, a rail line with rail lines. Across a stretch, lines go in
 * [lines]' order, a colour's together and drawn as one ([strokesOf]); a line alone keeps its middle.
 * A line going the other way on the very same line ([ONE_TRACK_M]: a track both ways run on, as a
 * subway's shapes are drawn) runs with them too; the order across is then the compass's (left to
 * right facing [FRAME_BEARING]'s half), so each line keeps one place whichever way it goes.
 * A stretch shared for less than [MIN_RUN_M] stays as the ones beside it, the line not stepping
 * aside and back for a moment.
 */
fun separateRoutes(lines: List<BusMapLine>, pieces: Map<String, List<List<GeoPoint>>>): Map<String, List<RouteRun>> {
    val byCode = lines.associateBy { it.code }
    val drawn = lines.filter { it.code in pieces }
    val first = drawn.firstNotNullOfOrNull { pieces[it.code]?.firstOrNull()?.firstOrNull() } ?: return emptyMap()
    val kx = M_PER_DEG * cos(Math.toRadians(first.latitude))
    fun xy(p: GeoPoint) = doubleArrayOf(p.longitude * kx, p.latitude * M_PER_DEG)

    // A colour's lines side by side, in the order its first comes; otherwise as listed.
    val colourRank = HashMap<String, Int>()
    val rank = HashMap<String, Int>()
    drawn.forEachIndexed { i, line ->
        rank[line.code] = colourRank.getOrPut(line.color.lowercase()) { i } * drawn.size + i
    }

    class Seg(val code: String, val rail: Boolean, val ax: Double, val ay: Double, val bx: Double, val by: Double)
    val grid = HashMap<Long, MutableList<Seg>>()
    for (line in drawn) {
        val rail = line.kind == "RAIL"
        for (piece in pieces[line.code].orEmpty()) {
            for (i in 0 until piece.size - 1) {
                val a = xy(piece[i])
                val b = xy(piece[i + 1])
                val seg = Seg(line.code, rail, a[0], a[1], b[0], b[1])
                for (cx in floor(minOf(a[0], b[0]) / CELL_M).toLong()..floor(maxOf(a[0], b[0]) / CELL_M).toLong()) {
                    for (cy in floor(minOf(a[1], b[1]) / CELL_M).toLong()..floor(maxOf(a[1], b[1]) / CELL_M).toLong()) {
                        grid.getOrPut((cx shl 32) xor (cy and 0xffffffffL)) { mutableListOf() } += seg
                    }
                }
            }
        }
    }

    // The other lines going [dx, dy]'s way within reach of (x, y), [rail] with [rail], or on that
    // very line the other way; and whether any goes the other way there.
    class Alongside(val codes: Set<String>, val back: Boolean)
    fun alongside(code: String, rail: Boolean, x: Double, y: Double, dx: Double, dy: Double): Alongside {
        val found = HashSet<String>()
        var back = false
        val cx = floor(x / CELL_M).toLong()
        val cy = floor(y / CELL_M).toLong()
        for (gx in cx - 1..cx + 1) for (gy in cy - 1..cy + 1) {
            for (s in grid[(gx shl 32) xor (gy and 0xffffffffL)] ?: continue) {
                if (s.rail != rail) continue
                val ex = s.bx - s.ax
                val ey = s.by - s.ay
                val len = hypot(ex, ey)
                if (len == 0.0) continue
                val along = (ex * dx + ey * dy) / len
                if (along > -SAME_WAY_COS && along < SAME_WAY_COS) continue
                val t = (((x - s.ax) * ex + (y - s.ay) * ey) / (len * len)).coerceIn(0.0, 1.0)
                val apart = hypot(x - s.ax - t * ex, y - s.ay - t * ey)
                if (along < 0 && apart <= ONE_TRACK_M) back = true
                if (s.code != code && (if (along > 0) apart <= SHARED_M else apart <= ONE_TRACK_M)) found += s.code
            }
        }
        return Alongside(found, back)
    }

    val slotCache = HashMap<List<String>, Map<String, Double>>()
    // [code]'s place going [dx, dy] among [with]: across its way, or the compass's with one going back.
    fun slotOf(code: String, with: Alongside, dx: Double, dy: Double): Double {
        if (with.codes.isEmpty()) return 0.0
        val together = (with.codes + code).sortedBy { rank[it] ?: Int.MAX_VALUE }
        val slots = slotCache.getOrPut(together) {
            strokesOf(together, 0.0, byCode).flatMap { stroke -> stroke.codes.map { it to stroke.slot } }.toMap()
        }
        val slot = slots[code] ?: 0.0
        if (!with.back) return slot
        return if (dx * FRAME_X + dy * FRAME_Y >= 0) slot else -slot
    }

    val out = LinkedHashMap<String, List<RouteRun>>()
    for (line in drawn) {
        val rail = line.kind == "RAIL"
        val runs = mutableListOf<RouteRun>()
        for (piece in pieces[line.code].orEmpty()) {
            if (piece.size < 2) continue
            // Each segment looked at every [STEP_M] along it: points, their slot, the length after each.
            val points = mutableListOf(piece[0])
            val vertex = mutableListOf(true)
            val slots = mutableListOf<Double>()
            val lengths = mutableListOf<Double>()
            for (i in 0 until piece.size - 1) {
                val a = piece[i]
                val b = piece[i + 1]
                val pa = xy(a)
                val pb = xy(b)
                val len = hypot(pb[0] - pa[0], pb[1] - pa[1])
                if (len == 0.0) continue
                val dx = (pb[0] - pa[0]) / len
                val dy = (pb[1] - pa[1]) / len
                val steps = ceil(len / STEP_M).toInt().coerceAtLeast(1)
                for (k in 0 until steps) {
                    val mid = (k + 0.5) / steps
                    val slot = slotOf(line.code, alongside(line.code, rail, pa[0] + (pb[0] - pa[0]) * mid, pa[1] + (pb[1] - pa[1]) * mid, dx, dy), dx, dy)
                    val end = (k + 1.0) / steps
                    points += if (k == steps - 1) b else GeoPoint(a.latitude + (b.latitude - a.latitude) * end, a.longitude + (b.longitude - a.longitude) * end)
                    vertex += k == steps - 1
                    slots += slot
                    lengths += len / steps
                }
            }
            if (slots.isEmpty()) continue
            settle(slots, lengths)
            // Consecutive pieces of one slot as one run; the sample points inside it dropped again.
            var start = 0
            for (i in 1..slots.size) {
                if (i < slots.size && slots[i] == slots[start]) continue
                val run = mutableListOf(points[start])
                for (j in start + 1..i) if (j == i || vertex[j]) run += points[j]
                runs += RouteRun(run, slots[start])
                start = i
            }
        }
        out[line.code] = runs
    }
    return out
}

/** Runs of one slot shorter than [MIN_RUN_M] take the slot of the longer run beside them, shortest first. */
private fun settle(slots: MutableList<Double>, lengths: List<Double>) {
    while (true) {
        data class Run(val from: Int, val to: Int, val length: Double)
        val runs = mutableListOf<Run>()
        var start = 0
        var length = 0.0
        for (i in slots.indices) {
            length += lengths[i]
            if (i == slots.size - 1 || slots[i + 1] != slots[start]) {
                runs += Run(start, i, length)
                start = i + 1
                length = 0.0
            }
        }
        if (runs.size < 2) return
        val shortest = runs.indices.minBy { runs[it].length }
        if (runs[shortest].length >= MIN_RUN_M) return
        val before = runs.getOrNull(shortest - 1)
        val after = runs.getOrNull(shortest + 1)
        val into = when {
            before == null -> after!!
            after == null -> before
            else -> if (before.length >= after.length) before else after
        }
        val slot = slots[into.from]
        for (i in runs[shortest].from..runs[shortest].to) slots[i] = slot
    }
}

private const val M_PER_DEG = 111_320.0

/** Two lines going one way this close run together: one lane. */
private const val SHARED_M = 3.0

/** Going the other way this close is the very same line: one track both ways run on. Laid on the roads, opposite ways are two or more apart. */
private const val ONE_TRACK_M = 1.5

/**
 * The compass's way across a line both ways run on: one facing within 90° of this bearing goes
 * left to right, one facing back right to left. Off the grids' ways (Jakarta's, near north and
 * east; Manhattan's, 29° and 119°), where a street's bundle would turn over.
 */
private const val FRAME_BEARING = -15.0
private val FRAME_X = kotlin.math.sin(Math.toRadians(FRAME_BEARING))
private val FRAME_Y = cos(Math.toRadians(FRAME_BEARING))

/** Within about 30° of one way. */
private const val SAME_WAY_COS = 0.85

/** How often along a line it looks for the lines running with it. */
private const val STEP_M = 10.0

/** The shortest a line keeps a place before it steps back. */
private const val MIN_RUN_M = 40.0

private const val CELL_M = 25.0
