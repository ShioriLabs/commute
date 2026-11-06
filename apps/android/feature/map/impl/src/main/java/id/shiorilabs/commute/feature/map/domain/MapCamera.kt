package id.shiorilabs.commute.feature.map.domain

import kotlin.math.abs
import kotlin.math.exp
import kotlin.math.max
import kotlin.math.min

/*
 * The map's camera, ported from the web (`map-clamp-transform.ts`, `map-easing.ts` and the camera
 * code in `routes/map.tsx`) so the two feel the same under a finger. The camera works in dp where
 * the web's works in CSS pixels, so its scales and speeds carry over as they are; only drawing
 * multiplies by the density.
 */

/** A world point lands on screen at `world * scale + (tx, ty)`, in dp. */
data class Transform(val tx: Double, val ty: Double, val scale: Double) {

    fun worldX(screenX: Double): Double = (screenX - tx) / scale
    fun worldY(screenY: Double): Double = (screenY - ty) / scale
}

/**
 * The size of the view the map is drawn into, in dp, and of the world it shows. [insetBottom] is
 * how much of the view's foot a sheet covers: the camera may pan the map up out from under it.
 */
data class Viewport(
    val width: Double,
    val height: Double,
    val worldWidth: Double,
    val worldHeight: Double,
    val insetBottom: Double = 0.0,
) {

    /** Cover-fit: the map's shorter side fills the view, so no bars show and the longer one pans. */
    val minScale: Double
        get() = if (width <= 0 || height <= 0 || worldWidth <= 0 || worldHeight <= 0) {
            FALLBACK_MIN_SCALE
        } else {
            max(width / worldWidth, height / worldHeight)
        }

    /**
     * [t] brought into range: scale within [minScale]..[maxScale], and the map's edges never
     * dragged inside the view. An axis the map doesn't fill is centred on. A hard clamp, no
     * rubber band, as on the web.
     *
     * A sheet's [insetBottom] relaxes only the bound on its side, so the map can be pushed up from
     * under it; the top edge still comes flush to the view's. Not reflected in [minScale], which
     * would let the map shrink narrower than the view on a portrait phone.
     */
    fun clamp(t: Transform): Transform {
        val scale = t.scale.coerceIn(minScale, max(minScale, maxScale))
        val scaledW = worldWidth * scale
        val scaledH = worldHeight * scale
        val usableH = height - insetBottom.coerceIn(0.0, height)
        val tx = if (scaledW <= width) (width - scaledW) / 2 else min(0.0, max(width - scaledW, t.tx))
        // Centred in the strip above the sheet, which starts at the top: no leading term.
        val ty = if (scaledH <= usableH) (usableH - scaledH) / 2 else min(0.0, max(usableH - scaledH, t.ty))
        return Transform(tx, ty, scale)
    }

    /**
     * [t] moved so world point ([x], [y]) sits in the middle of what the sheet leaves showing, at
     * [t]'s scale: the web's `flyToPoint`.
     */
    fun focus(t: Transform, x: Double, y: Double): Transform =
        clamp(Transform(width / 2 - x * t.scale, (height - insetBottom.coerceIn(0.0, height)) / 2 - y * t.scale, t.scale))

    /** The finest zoom, in dp per world unit; past it the 2x tiles go soft. */
    val maxScale: Double get() = MAX_SCALE

    /** [t] zoomed by [factor] about screen point ([px], [py]), which stays over the same world point. */
    fun zoomAt(t: Transform, px: Double, py: Double, factor: Double): Transform {
        val scale = (t.scale * factor).coerceIn(minScale, max(minScale, maxScale))
        val worldX = t.worldX(px)
        val worldY = t.worldY(py)
        return clamp(Transform(px - worldX * scale, py - worldY * scale, scale))
    }

    /** [t] moved so world point ([x], [y]) sits at the view's centre, at [t]'s scale. */
    fun centeredOn(t: Transform, x: Double, y: Double): Transform =
        clamp(Transform(width / 2 - x * t.scale, height / 2 - y * t.scale, t.scale))

    /**
     * Where the map opens: centred on world point ([x], [y]), Manggarai on the web, at the cover
     * fit or [INITIAL_SCALE_FLOOR], whichever is closer. The middle of the map without a point.
     */
    fun initial(x: Double? = null, y: Double? = null): Transform {
        val scale = max(minScale, INITIAL_SCALE_FLOOR)
        return centeredOn(Transform(0.0, 0.0, scale), x ?: (worldWidth / 2), y ?: (worldHeight / 2))
    }

    companion object {

        const val MAX_SCALE = 1.5

        /** Opening any further out leaves the stations too small to tap. */
        const val INITIAL_SCALE_FLOOR = 0.5

        /** The station the map opens on. */
        const val INITIAL_STATION_ID = "KCI-MRI"

        /** A sheet peeks over this much of the view's height, as the web's `PEEK_FRACTION`. */
        const val PEEK_FRACTION = 0.3

        private const val FALLBACK_MIN_SCALE = 0.01
    }
}

/** Glides the drawn transform toward the requested one between gestures (`LERP_TAU_MS`). */
const val LERP_TAU_MS = 80.0

/** A frame's step is cut to this, so a stall doesn't land as a jump. */
const val MAX_FRAME_DT_MS = 64.0

/** One frame of [from] gliding toward [to] over [dtMs]. */
fun lerpTransform(from: Transform, to: Transform, dtMs: Double): Transform {
    val k = 1 - exp(-dtMs.coerceIn(0.0, MAX_FRAME_DT_MS) / LERP_TAU_MS)
    return Transform(
        from.tx + (to.tx - from.tx) * k,
        from.ty + (to.ty - from.ty) * k,
        from.scale + (to.scale - from.scale) * k,
    )
}

/** Whether [a] and [b] are close enough that drawing one more frame between them shows nothing. */
fun settled(a: Transform, b: Transform): Boolean =
    abs(a.tx - b.tx) + abs(a.ty - b.ty) <= SETTLE_PX && abs(a.scale - b.scale) <= SETTLE_SCALE

private const val SETTLE_PX = 0.05
private const val SETTLE_SCALE = 1e-5

/**
 * A pan's momentum after the finger lifts, in dp per millisecond: it decays with [FLING_TAU_MS]
 * and stops below [FLING_STOP_DP_PER_MS].
 */
data class Fling(val vx: Double, val vy: Double) {

    val isSpent: Boolean get() = abs(vx) < FLING_STOP_DP_PER_MS && abs(vy) < FLING_STOP_DP_PER_MS

    /**
     * One frame of the fling over [dtMs]: [t] moved by the frame's average velocity and clamped,
     * and the fling that is left. A fling into the map's edge stops there.
     */
    fun step(t: Transform, dtMs: Double, viewport: Viewport): Pair<Transform, Fling> {
        val dt = dtMs.coerceIn(0.0, MAX_FRAME_DT_MS)
        val decay = exp(-dt / FLING_TAU_MS)
        val travel = (1 + decay) / 2 * dt
        val moved = viewport.clamp(Transform(t.tx + vx * travel, t.ty + vy * travel, t.scale))
        // Whatever the clamp took off an axis, the fling has nothing left to give on it.
        val nextVx = if (moved.tx == t.tx + vx * travel) vx * decay else 0.0
        val nextVy = if (moved.ty == t.ty + vy * travel) vy * decay else 0.0
        return moved to Fling(nextVx, nextVy)
    }

    companion object {

        const val FLING_TAU_MS = 180.0
        const val FLING_STOP_DP_PER_MS = 0.04
    }
}

/** A camera move over [durationMs] on the camera curve, as a double tap's zoom. */
data class Flight(val from: Transform, val to: Transform, val durationMs: Double) {

    /** Where the flight is [elapsedMs] in; exactly [to] once it's over. */
    fun at(elapsedMs: Double): Transform {
        if (durationMs <= 0 || elapsedMs >= durationMs) return to
        val k = easeCameraFlight(elapsedMs / durationMs)
        return Transform(
            from.tx + (to.tx - from.tx) * k,
            from.ty + (to.ty - from.ty) * k,
            from.scale + (to.scale - from.scale) * k,
        )
    }

    fun isOver(elapsedMs: Double): Boolean = elapsedMs >= durationMs

    companion object {

        /** A double tap's zoom in or back out. */
        const val ZOOM_STEP_MS = 350.0

        /** To a tapped station, as its sheet comes up. */
        const val TO_POINT_MS = 450.0

        /** Back into range as a sheet opens or closes under the map. */
        const val SETTLE_MS = 240.0
    }
}

/*
 * The camera curve, cubic-bezier(0.45, 0.25, 0.2, 1): front-loaded with a hard late deceleration,
 * monotonic so a flight never overshoots a clamped destination. Solved for x with Newton steps, as
 * the web solves it.
 */
private const val P1X = 0.45
private const val P1Y = 0.25
private const val P2X = 0.2
private const val P2Y = 1.0

private const val CX = 3 * P1X
private const val BX = 3 * (P2X - P1X) - CX
private const val AX = 1 - CX - BX

private const val CY = 3 * P1Y
private const val BY = 3 * (P2Y - P1Y) - CY
private const val AY = 1 - CY - BY

private fun sampleX(t: Double) = ((AX * t + BX) * t + CX) * t
private fun sampleY(t: Double) = ((AY * t + BY) * t + CY) * t
private fun slopeX(t: Double) = (3 * AX * t + 2 * BX) * t + CX

/** Eased 0..1 for linear progress [p]; the ends exactly, so a flight lands on its destination. */
fun easeCameraFlight(p: Double): Double {
    if (p <= 0) return 0.0
    if (p >= 1) return 1.0
    var t = p
    repeat(8) {
        val error = sampleX(t) - p
        if (abs(error) < 1e-7) return sampleY(t)
        val d = slopeX(t)
        if (abs(d) < 1e-7) return sampleY(t)
        t -= error / d
    }
    return sampleY(t)
}
