package id.shiorilabs.commute.feature.map.domain

import kotlin.math.hypot

/**
 * The map's touch handling, ported from the web's pointer handlers in `routes/map.tsx`: raw pointer
 * events in, camera intents out. No Android types, so it runs under JUnit.
 *
 * - One finger pans 1:1.
 * - A second finger pinches about the midpoint where it landed, which stays put: no two-finger pan.
 * - A finger lifted after a drag flings, from its last [VELOCITY_WINDOW_MS] of movement. Never after
 *   a pinch.
 * - A touch that moved no more than [TAP_SLOP_DP] and never had company is a [Event.Tap], reported
 *   at once. A second one within [DOUBLE_TAP_MS] and [DOUBLE_TAP_SLOP_DP] of it is an
 *   [Event.DoubleTap] instead, unless [forgetTap] said the first one opened something.
 *
 * Positions are dp, the map's camera units, as the web's are CSS pixels: its thresholds carry over
 * as they are.
 */
class MapGestures {

    /** What a gesture asks of the camera. Positions are dp from the view's top left. */
    sealed interface Event {

        /** A finger landed: stop any fling or flight, and follow the fingers 1:1 until [Released]. */
        data object Grabbed : Event

        /** The last finger lifted. */
        data object Released : Event

        data class Pan(val dx: Double, val dy: Double) : Event

        /** A pinch began: [Pinch] factors are relative to the scale at this moment. */
        data object PinchStarted : Event

        /** The pinch, [factor] times its starting scale, about where it began. */
        data class Pinch(val anchorX: Double, val anchorY: Double, val factor: Double) : Event

        /** dp per millisecond. */
        data class Fling(val vx: Double, val vy: Double) : Event

        data class Tap(val x: Double, val y: Double) : Event

        data class DoubleTap(val x: Double, val y: Double) : Event
    }

    private class Pointer(
        var x: Double,
        var y: Double,
        val startX: Double,
        val startY: Double,
        var maxDistance: Double = 0.0,
        val samples: ArrayDeque<Sample> = ArrayDeque(),
    )

    private data class Sample(val timeMs: Long, val x: Double, val y: Double)

    private data class PinchStart(val distance: Double, val anchorX: Double, val anchorY: Double)

    private data class LastTap(val timeMs: Long, val x: Double, val y: Double)

    // Insertion-ordered, so the pinch's two fingers are the first two down, as on the web.
    private val pointers = LinkedHashMap<Long, Pointer>()
    private var pinch: PinchStart? = null
    private var hadCompany = false
    private var lastTap: LastTap? = null

    fun down(id: Long, x: Double, y: Double, timeMs: Long): List<Event> {
        val events = mutableListOf<Event>()
        if (pointers.isEmpty()) {
            hadCompany = false
            events += Event.Grabbed
        }
        pointers[id] = Pointer(x, y, startX = x, startY = y).also { it.samples.addLast(Sample(timeMs, x, y)) }
        if (pointers.size >= 2) {
            hadCompany = true
        }
        if (pointers.size == 2) {
            val (a, b) = pointers.values.toList()
            pinch = PinchStart(hypot(b.x - a.x, b.y - a.y), (a.x + b.x) / 2, (a.y + b.y) / 2)
            events += Event.PinchStarted
        }
        return events
    }

    fun move(id: Long, x: Double, y: Double, timeMs: Long): List<Event> {
        val pointer = pointers[id] ?: return emptyList()
        val dx = x - pointer.x
        val dy = y - pointer.y
        pointer.x = x
        pointer.y = y
        pointer.maxDistance = maxOf(pointer.maxDistance, hypot(x - pointer.startX, y - pointer.startY))
        pointer.samples.addLast(Sample(timeMs, x, y))
        while (pointer.samples.size > 2 && pointer.samples.first().timeMs < timeMs - VELOCITY_WINDOW_MS) {
            pointer.samples.removeFirst()
        }

        val start = pinch
        return when {
            pointers.size == 1 -> listOf(Event.Pan(dx, dy))
            start != null && start.distance > 0 -> {
                val (a, b) = pointers.values.toList()
                listOf(Event.Pinch(start.anchorX, start.anchorY, hypot(b.x - a.x, b.y - a.y) / start.distance))
            }

            else -> emptyList()
        }
    }

    fun up(id: Long, x: Double, y: Double, timeMs: Long): List<Event> {
        val pointer = pointers.remove(id) ?: return emptyList()
        val wasPinching = pinch != null
        val wasDrag = pointer.maxDistance > TAP_SLOP_DP
        val events = mutableListOf<Event>()

        if (!wasDrag && !wasPinching && !hadCompany) {
            val previous = lastTap
            if (previous != null && timeMs - previous.timeMs < DOUBLE_TAP_MS &&
                hypot(x - previous.x, y - previous.y) < DOUBLE_TAP_SLOP_DP
            ) {
                lastTap = null
                events += Event.DoubleTap(x, y)
            } else {
                lastTap = LastTap(timeMs, x, y)
                events += Event.Tap(x, y)
            }
        }

        if (pointers.size < 2) {
            pinch = null
        }
        if (pointers.isEmpty()) {
            events += Event.Released
            val samples = pointer.samples
            if (wasDrag && !wasPinching && samples.size >= 2) {
                val first = samples.first()
                val last = samples.last()
                val dt = (last.timeMs - first.timeMs).toDouble()
                if (dt > 0) {
                    events += Event.Fling((last.x - first.x) / dt, (last.y - first.y) / dt)
                }
            }
        }
        return events
    }

    /** The system took the touch away, as when a parent started scrolling: no tap, no fling. */
    fun cancel(): List<Event> {
        if (pointers.isEmpty()) return emptyList()
        pointers.clear()
        pinch = null
        return listOf(Event.Released)
    }

    /** The last [Event.Tap] opened something, so a quick second one isn't a double tap. */
    fun forgetTap() {
        lastTap = null
    }

    companion object {

        /** Further than this from where it landed and a touch is a drag, not a tap. */
        const val TAP_SLOP_DP = 8.0

        const val DOUBLE_TAP_MS = 300L
        const val DOUBLE_TAP_SLOP_DP = 30.0

        /** How much of a drag's end its fling is measured over. */
        const val VELOCITY_WINDOW_MS = 80L
    }
}
