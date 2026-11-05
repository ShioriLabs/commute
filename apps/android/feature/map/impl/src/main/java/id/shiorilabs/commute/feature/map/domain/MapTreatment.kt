package id.shiorilabs.commute.feature.map.domain

import kotlin.math.hypot

/*
 * How the artwork is set back this frame, and where it isn't: the web's `mapTreatment` and its
 * overlays (`map-renderer.ts`), the one answer the renderer draws from. The renderer is stateless
 * with respect to time; the animations decide these values and hand them over every frame.
 */

/** How far a selection blends the map toward white, and how much colour it drains, 0..1. */
const val SELECTION_FADE_MAX = 0.6
const val SELECTION_DESATURATE_MAX = 0.25

/** World units, so the spotlight stays attached to the map at every zoom. */
const val SPOTLIGHT_FEATHER_WORLD = 26.0
const val RING_WIDTH_WORLD = 5.0

/** The ring settles from this far outside the shape to [RING_REST_OFFSET_WORLD] as it comes in. */
const val RING_MAX_OFFSET_WORLD = 30.0
const val RING_REST_OFFSET_WORLD = 8.0

/** A hole in the fade: a rounded box as [MapPoint]'s, punched [alpha] strongly. */
data class CutShape(
    val ax: Double,
    val ay: Double,
    val bx: Double,
    val by: Double,
    val r: Double,
    val cr: Double,
    val alpha: Double = 1.0,
)

/** [point]'s own shape, as a hole punched [alpha] strongly. */
fun MapPoint.toCutShape(alpha: Double = 1.0): CutShape = CutShape(ax, ay, bx, by, r, cornerRadius, alpha)

/**
 * The selected station or hub this frame: its marker, the name drawn for it, the line colour its
 * ring takes, and how far along the spotlight is.
 *
 * @property fadeAlpha 0..[SELECTION_FADE_MAX]: how far the map outside the holes is faded now.
 * @property ringProgress 0..1: the ring's settle-in and its strength. Zero for a shape drawn
 *   without one.
 * @property openProgress 0..1: how far the holes have opened. Apart from the fade, which starts
 *   from whatever was already drawn.
 */
data class SelectionOverlay(
    val point: MapPoint,
    val label: MapPoint?,
    val color: Rgb,
    val fadeAlpha: Double,
    val ringProgress: Double,
    val openProgress: Double,
)

/**
 * An isolated line's shapes, held at full strength while the rest of the network fades, and the
 * line being switched away from, still closing.
 */
data class LineIsolateOverlay(
    val shapes: List<CutShape>,
    val fadeAlpha: Double,
    val openProgress: Double = 1.0,
    val closingShapes: List<CutShape> = emptyList(),
    val closingProgress: Double = 0.0,
)

/** The map-wide fade a drawn route asks for. */
data class RouteTreatment(val fade: Double, val desaturate: Double)

/** A colour, each channel 0..1. */
data class Rgb(val r: Double, val g: Double, val b: Double) {

    companion object {

        /** The ring before the station's line colour has arrived. */
        val Neutral = Rgb(0.39, 0.45, 0.55)

        /** `#RRGGBB`, or null for anything else. */
        fun parse(hex: String?): Rgb? {
            val digits = hex?.removePrefix("#")?.takeIf { it.length == 6 } ?: return null
            val value = digits.toIntOrNull(16) ?: return null
            return Rgb(((value shr 16) and 0xFF) / 255.0, ((value shr 8) and 0xFF) / 255.0, (value and 0xFF) / 255.0)
        }
    }
}

/**
 * The ring around the selection: [shape]'s edge pushed out by [offset], [width] wide, drawn
 * [alpha] strongly in [color].
 */
data class Ring(val shape: CutShape, val color: Rgb, val offset: Double, val width: Double, val alpha: Double)

/**
 * The artwork's treatment this frame: [fade] toward white and [desaturate] everywhere but [cuts],
 * which ramp back in over [feather] world units, plus the [ring] around a selection.
 */
data class MapTreatment(
    val fade: Double,
    val desaturate: Double,
    val cuts: List<CutShape>,
    val feather: Double,
    val ring: Ring?,
) {

    companion object {

        val None = MapTreatment(0.0, 0.0, emptyList(), 0.0, null)
    }
}

/**
 * The selection, the isolate and the route combined into one treatment: the strongest fade of
 * them, as two fades toward white would multiply into a blank page, and the map never visibly
 * regains contrast as one takes over from another.
 *
 * Only a selection or an isolate punches holes; a route fades the whole map, its own capsules drawn
 * at full strength on top. Desaturation follows the fade's own progress, so the pair stay in
 * proportion through the whole animation.
 */
fun mapTreatment(
    selection: SelectionOverlay?,
    isolate: LineIsolateOverlay? = null,
    route: RouteTreatment? = null,
): MapTreatment {
    val routeFade = route?.fade ?: 0.0
    val routeDesaturate = route?.desaturate ?: 0.0
    val selectionFade = selection?.fadeAlpha ?: 0.0
    val isolateFade = if (isolate != null && isolate.shapes.isNotEmpty()) isolate.fadeAlpha else 0.0
    val fade = maxOf(routeFade, selectionFade, isolateFade)
    val desaturate = maxOf(routeDesaturate, maxOf(selectionFade, isolateFade) / SELECTION_FADE_MAX * SELECTION_DESATURATE_MAX)

    val cuts = mutableListOf<CutShape>()
    if (isolate != null && isolateFade > 0) {
        // The holes open with the isolate's own progress, not its fade, which starts from whatever
        // was already drawn and would report them open from the first frame.
        isolate.shapes.mapTo(cuts) { it.copy(alpha = isolate.openProgress) }
        if (isolate.closingProgress > 0) {
            isolate.closingShapes.mapTo(cuts) { it.copy(alpha = isolate.closingProgress) }
        }
    }
    var ring: Ring? = null
    if (selection != null && selectionFade > 0) {
        cuts += selection.point.toCutShape(selection.openProgress)
        selection.label?.let { cuts += it.toCutShape(selection.openProgress) }
    }
    if (selection != null && selection.ringProgress > 0) {
        ring = Ring(
            shape = selection.point.toCutShape(),
            color = selection.color,
            offset = ringOffsetWorld(selection.ringProgress),
            width = RING_WIDTH_WORLD,
            alpha = selection.ringProgress,
        )
    }
    return MapTreatment(fade, desaturate, cuts, if (cuts.isNotEmpty()) SPOTLIGHT_FEATHER_WORLD else 0.0, ring)
}

fun ringOffsetWorld(ringProgress: Double): Double =
    RING_MAX_OFFSET_WORLD + (RING_REST_OFFSET_WORLD - RING_MAX_OFFSET_WORLD) * ringProgress

/**
 * The fade a new treatment starts from: the strongest of those already drawn, the one the rider
 * can see, so handing one over to another never dips the map through brighter and back.
 */
fun seedFadeFrom(vararg drawn: Double?): Double = drawn.filterNotNull().fold(0.0) { seed, fade -> maxOf(seed, fade) }

/**
 * The name drawn for [marker]: the nearest label of its station, as a halte can be drawn twice and
 * a station can carry more than one name. Null for a label, or a station with no name drawn.
 */
fun markerLabel(marker: MapPoint, labels: List<MapPoint>): MapPoint? {
    if (marker.isLabel) return null
    return labels
        .filter { it.stationId == marker.stationId }
        .minByOrNull { hypot(it.centerX - marker.centerX, it.centerY - marker.centerY) }
}
