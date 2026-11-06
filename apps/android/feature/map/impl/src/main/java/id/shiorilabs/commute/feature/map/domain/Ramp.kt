package id.shiorilabs.commute.feature.map.domain

import kotlin.math.pow

/**
 * A fade between 0 and 1 over [durationMs] on the ease-out cubic every fade on the map shares,
 * turned round from whatever it shows when its target changes, so reversing mid-fade never jumps.
 * The web's route ramps.
 */
class Ramp(private val durationMs: Double = ROUTE_FADE_MS) {

    private var on = false
    private var startMs = 0L
    private var from = 0.0

    /** What [value] showed last. */
    var last: Double = 0.0
        private set

    /** Heads for 1 when [on], else 0, from what it showed last. */
    fun set(on: Boolean, nowMs: Long) {
        if (on == this.on) return
        this.on = on
        startMs = nowMs
        from = last
    }

    fun value(nowMs: Long): Double {
        val p = ((nowMs - startMs) / durationMs).coerceIn(0.0, 1.0)
        val target = if (on) 1.0 else 0.0
        last = from + (target - from) * (1 - (1 - p).pow(3))
        return last
    }

    /** Whether it is still on its way: a frame is due while it is. */
    val isAnimating: Boolean get() = last != if (on) 1.0 else 0.0

    companion object {

        const val ROUTE_FADE_MS = 250.0
    }
}
