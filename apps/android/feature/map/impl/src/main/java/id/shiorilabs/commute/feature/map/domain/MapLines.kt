package id.shiorilabs.commute.feature.map.domain

import kotlinx.serialization.Serializable

/**
 * The web's `map-lines.json`: each line's stroke on the artwork, traced at build time
 * (`scripts/build-map-lines.ts`), and the stations along it. What isolating a line holds sharp.
 */
@Serializable
data class MapLines(
    /** The map edition these were traced on; must match [MapManifest.version]. */
    val version: String,
    val lines: List<MapLine>,
)

/** One line's traced geometry, in world units, keyed `OPERATOR:CODE` as the app's lines are. */
@Serializable
data class MapLine(
    val key: String,
    val operator: String,
    val code: String,
    val name: String,
    /** Its brand colour, `#RRGGBB`. */
    val color: String,
    /** Half the stroke's width. */
    val r: Double,
    val segments: List<MapLineSegment>,
)

/**
 * A stretch of a line: its trunk, a branch, a loop. [edges] are `[ax, ay, bx, by]` along the
 * stroke, and [markers] the stations on it, by `OPERATOR-CODE`.
 */
@Serializable
data class MapLineSegment(
    val kind: String,
    val edges: List<List<Double>>,
    val markers: List<String>,
)
