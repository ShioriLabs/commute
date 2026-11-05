package id.shiorilabs.commute.feature.map.render

import id.shiorilabs.commute.feature.map.domain.MapTreatment

/**
 * A capsule drawn over the map in one colour, alpha straight (not premultiplied): a hitbox, or a
 * piece of a drawn route.
 */
data class Pill(
    val ax: Double,
    val ay: Double,
    val bx: Double,
    val by: Double,
    val r: Double,
    val cr: Double,
    val red: Double,
    val green: Double,
    val blue: Double,
    val alpha: Double,
)

/*
 * The overlay as the renderer reads it: one float array per frame, so a frame crosses into C++ in
 * one call. The layout is mirrored by `OverlayLayout` in renderer.cpp; change both together.
 *
 *   [0] fade  [1] desaturate  [2] feather  [3] cut count  [4] pill count  [5] ring on (0/1)
 *   [6..17]   ring: ax ay bx by r cr, red green blue, offset width alpha
 *   then      cuts, CUT_STRIDE each: ax ay bx by r cr alpha
 *   then      pills, PILL_STRIDE each: ax ay bx by r cr red green blue alpha
 */
const val OVERLAY_HEADER = 18
const val CUT_STRIDE = 7
const val PILL_STRIDE = 10

/** [treatment] and [pills], packed for [MapNative.draw]. */
fun packOverlay(treatment: MapTreatment, pills: List<Pill>): FloatArray {
    val cuts = treatment.cuts
    val out = FloatArray(OVERLAY_HEADER + cuts.size * CUT_STRIDE + pills.size * PILL_STRIDE)
    out[0] = treatment.fade.toFloat()
    out[1] = treatment.desaturate.toFloat()
    out[2] = treatment.feather.toFloat()
    out[3] = cuts.size.toFloat()
    out[4] = pills.size.toFloat()
    treatment.ring?.let { ring ->
        out[5] = 1f
        val s = ring.shape
        floatArrayOf(
            s.ax.toFloat(), s.ay.toFloat(), s.bx.toFloat(), s.by.toFloat(), s.r.toFloat(), s.cr.toFloat(),
            ring.color.r.toFloat(), ring.color.g.toFloat(), ring.color.b.toFloat(),
            ring.offset.toFloat(), ring.width.toFloat(), ring.alpha.toFloat(),
        ).copyInto(out, destinationOffset = 6)
    }
    var i = OVERLAY_HEADER
    for (cut in cuts) {
        out[i++] = cut.ax.toFloat()
        out[i++] = cut.ay.toFloat()
        out[i++] = cut.bx.toFloat()
        out[i++] = cut.by.toFloat()
        out[i++] = cut.r.toFloat()
        out[i++] = cut.cr.toFloat()
        out[i++] = cut.alpha.toFloat()
    }
    for (pill in pills) {
        out[i++] = pill.ax.toFloat()
        out[i++] = pill.ay.toFloat()
        out[i++] = pill.bx.toFloat()
        out[i++] = pill.by.toFloat()
        out[i++] = pill.r.toFloat()
        out[i++] = pill.cr.toFloat()
        out[i++] = pill.red.toFloat()
        out[i++] = pill.green.toFloat()
        out[i++] = pill.blue.toFloat()
        out[i++] = pill.alpha.toFloat()
    }
    return out
}
