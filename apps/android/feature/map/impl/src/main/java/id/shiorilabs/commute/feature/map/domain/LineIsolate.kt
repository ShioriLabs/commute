package id.shiorilabs.commute.feature.map.domain

import kotlin.math.hypot
import kotlin.math.min
import kotlin.math.pow

/*
 * Isolating a line, the web's `map-line-isolate.ts` and its `isolateRef` phases: the network faded
 * but for one line's stroke, its stations' markers and their names.
 */

/**
 * Every shape held at full strength while [line] is isolated: each traced edge as a capsule, each
 * station's marker, and each station's name, as a line held sharp while the names of its stops go
 * pale is half an answer.
 */
fun lineCutShapes(line: MapLine, points: List<MapPoint>, labels: List<MapPoint>): List<CutShape> {
    val markers = HashMap<String, MapPoint>()
    for (point in points) {
        if (point.isLabel) continue
        val stationId = point.stationId
        // The first of a twice-drawn halte, but an exact id beats an alias: the rule the tracer and
        // the route overlay use, so all three agree on which shape a station means.
        if (point.id == stationId || stationId !in markers) markers[stationId] = point
    }
    val names = HashMap<String, MapPoint>()
    for (label in labels) names.putIfAbsent(label.stationId, label)

    val shapes = mutableListOf<CutShape>()
    val seen = HashSet<String>()
    for (segment in line.segments) {
        for ((ax, ay, bx, by) in segment.edges) {
            shapes += CutShape(ax, ay, bx, by, line.r, line.r)
        }
        for (stationId in segment.markers) {
            // A branch shares its junction with the trunk: one hole, not one per branch.
            if (!seen.add(stationId)) continue
            markers[stationId]?.let { shapes += it.toCutShape() }
            names[stationId]?.let { shapes += it.toCutShape() }
        }
    }
    return shapes
}

/** The line keyed [key], `OPERATOR:CODE`; null for one with no traced geometry. */
fun List<MapLine>.lineOf(key: String): MapLine? = firstOrNull { it.key == key }

/**
 * The lines whose stroke passes within [slop] of world point ([x], [y]), nearest first, by key.
 * The artwork draws a line's two directions as two strokes, which collapse to the one line; only
 * an interlined trunk, which really does carry several, comes back with more than one.
 */
fun linesNear(lines: List<MapLine>, x: Double, y: Double, slop: Double): List<String> =
    lines
        .mapNotNull { line ->
            val nearest = line.segments.minOfOrNull { segment ->
                segment.edges.minOfOrNull { (ax, ay, bx, by) -> distanceToSegment(x, y, ax, ay, bx, by) }
                    ?: Double.POSITIVE_INFINITY
            } ?: Double.POSITIVE_INFINITY
            (line.key to nearest).takeIf { nearest <= line.r + slop }
        }
        .sortedBy { it.second }
        .map { it.first }

private fun distanceToSegment(px: Double, py: Double, ax: Double, ay: Double, bx: Double, by: Double): Double {
    val dx = bx - ax
    val dy = by - ay
    val lengthSquared = dx * dx + dy * dy
    if (lengthSquared == 0.0) return hypot(px - ax, py - ay)
    val t = (((px - ax) * dx + (py - ay) * dy) / lengthSquared).coerceIn(0.0, 1.0)
    return hypot(px - (ax + t * dx), py - (ay + t * dy))
}

/**
 * A line isolated over time, with the spotlight's phases and timings, as a fade is a fade: in over
 * [Spotlight.IN_MS] on an ease-out cubic, held, then out over [Spotlight.OUT_MS] from wherever it
 * had got to. Its holes open apart from the fade, which starts from whatever was already drawn.
 *
 * Switched to from another line, that line's [closingShapes] close as these open, from how far
 * open it was ([closingFrom]), so the two cross rather than cut.
 */
class LineIsolate(
    val key: String,
    val shapes: List<CutShape>,
    startMs: Long,
    /** The fade already on screen when it began, which it carries on from: see [seedFadeFrom]. */
    fadeFrom: Double = 0.0,
    private val closingShapes: List<CutShape> = emptyList(),
    closingFrom: Double = 0.0,
) {

    private enum class Phase { IN, HOLD, OUT }

    private var phase = Phase.IN
    private var phaseStartMs = startMs
    private var fadeFrom = fadeFrom
    private var openFrom = 0.0
    private var closingFrom = if (closingShapes.isEmpty()) 0.0 else closingFrom

    /** The fade drawn on the last [frame], for whatever takes over to start from. */
    var lastFade: Double = fadeFrom
        private set

    /** How far open its holes were on the last [frame], for a switch to close them from. */
    var lastOpen: Double = 0.0
        private set
    private var lastClosing = this.closingFrom

    /** Whether it has finished fading out; nothing is drawn for it any more. */
    var isGone: Boolean = false
        private set

    /** Whether it is on its way out, or gone. */
    val isLeaving: Boolean get() = isGone || phase == Phase.OUT

    /** Whether [frame] changes from one moment to the next: a frame is due while it does. */
    val isAnimating: Boolean get() = !isGone && phase != Phase.HOLD

    /** Fades out from whatever it shows at [nowMs]. Does nothing once already fading out. */
    fun exit(nowMs: Long) {
        if (isLeaving) return
        phase = Phase.OUT
        phaseStartMs = nowMs
        fadeFrom = lastFade
        openFrom = lastOpen
        // A switch still crossing finishes leaving from where it got to, rather than popping back.
        closingFrom = lastClosing
    }

    /** The overlay at [nowMs], or null once it has gone. */
    fun frame(nowMs: Long): LineIsolateOverlay? {
        if (isGone) return null
        val elapsed = (nowMs - phaseStartMs).toDouble()
        val fade: Double
        val open: Double
        val closing: Double
        when (phase) {
            Phase.IN -> {
                val p = min(1.0, elapsed / Spotlight.IN_MS)
                val e = 1 - (1 - p).pow(3)
                fade = fadeFrom + (SELECTION_FADE_MAX - fadeFrom) * e
                open = e
                closing = closingFrom * (1 - e)
                if (p >= 1) phase = Phase.HOLD
            }

            Phase.HOLD -> {
                fade = SELECTION_FADE_MAX
                open = 1.0
                closing = 0.0
            }

            Phase.OUT -> {
                val p = min(1.0, elapsed / Spotlight.OUT_MS)
                fade = fadeFrom * (1 - p)
                open = openFrom * (1 - p)
                closing = closingFrom * (1 - p)
                if (p >= 1) isGone = true
            }
        }
        lastFade = fade
        lastOpen = open
        lastClosing = closing
        return LineIsolateOverlay(
            shapes = shapes,
            fadeAlpha = fade,
            openProgress = open,
            closingShapes = if (closing > 0) closingShapes else emptyList(),
            closingProgress = closing,
        )
    }

    companion object {

        /**
         * Isolates line [key] by [shapes] at [nowMs], taking over from [previous] and whatever else
         * is drawn ([alsoDrawn], the spotlight's fade) without the map brightening in between.
         */
        fun after(
            previous: LineIsolate?,
            key: String,
            shapes: List<CutShape>,
            nowMs: Long,
            alsoDrawn: Double? = null,
        ): LineIsolate {
            // Only a different line closes: the same one again would close a copy under itself.
            val handOff = previous?.takeIf { it.key != key && it.lastOpen > 0 }
            return LineIsolate(
                key = key,
                shapes = shapes,
                startMs = nowMs,
                fadeFrom = seedFadeFrom(previous?.lastFade, alsoDrawn),
                closingShapes = handOff?.shapes.orEmpty(),
                closingFrom = handOff?.lastOpen ?: 0.0,
            )
        }
    }
}
