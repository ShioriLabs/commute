package id.shiorilabs.commute.feature.map.domain

import kotlinx.serialization.Serializable
import kotlin.math.abs
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min

/**
 * The web's `points.json` or `label-points.json`: the map's tap targets, drawn over its artwork by
 * hand (see `docs/fdtj-map-points.md`).
 */
@Serializable
data class MapPoints(
    /** The map edition these were authored against; must match [MapManifest.version]. */
    val version: String,
    val points: List<MapPoint>,
)

/**
 * One tap target: an oriented rounded rectangle along `a → b`, [r] wide either side and [r] past
 * each end, its corners rounded by [cr] (a capsule without one). World units, as the tiles.
 *
 * [id] is the drawn shape's own key. `HUB-` ids are hub regions and `LBL-` ids station names; the
 * station a shape opens is [stationId], never [id].
 */
@Serializable
data class MapPoint(
    val id: String,
    val ax: Double,
    val ay: Double,
    val bx: Double,
    val by: Double,
    val r: Double,
    val cr: Double? = null,
    /** The station when it isn't [id]: a halte drawn twice, or a label. */
    val station: String? = null,
    /** Selected, it gets no ring, only the fade: a halo around a word reads as a box. Labels. */
    val noRing: Boolean = false,
) {

    /** The `OPERATOR-CODE` this shape opens. */
    val stationId: String get() = station ?: id

    val isHub: Boolean get() = id.startsWith(HUB_PREFIX)
    val isLabel: Boolean get() = id.startsWith(LABEL_PREFIX)

    val centerX: Double get() = (ax + bx) / 2
    val centerY: Double get() = (ay + by) / 2

    /** The corner radius, within `0..r`; a missing one rounds fully. */
    val cornerRadius: Double get() = (cr ?: r).coerceIn(0.0, max(r, 0.0))

    /**
     * Signed distance from ([x], [y]) to this shape's edge, negative inside: the standard rounded-box
     * SDF in the shape's own frame (along `a → b`, and across it).
     */
    fun signedDistance(x: Double, y: Double): Double {
        val abx = bx - ax
        val aby = by - ay
        val len = hypot(abx, aby)
        val dirX = if (len > 0) abx / len else 1.0
        val dirY = if (len > 0) aby / len else 0.0
        val relX = x - centerX
        val relY = y - centerY
        val corner = cornerRadius
        // Folded into the first quadrant, the box shrunk by the corner radius.
        val qx = abs(relX * dirX + relY * dirY) - (len / 2 + r - corner)
        val qy = abs(relX * -dirY + relY * dirX) - (r - corner)
        return hypot(max(qx, 0.0), max(qy, 0.0)) + min(max(qx, qy), 0.0) - corner
    }

    private companion object {

        const val HUB_PREFIX = "HUB-"
        const val LABEL_PREFIX = "LBL-"
    }
}

/** What a tap landed on. */
sealed interface MapHit {

    val point: MapPoint

    /** A station's marker; a tap on its name resolves to the marker too. */
    data class Station(override val point: MapPoint) : MapHit

    /** A hub's region, outside every member's marker. */
    data class Hub(override val point: MapPoint) : MapHit
}

/**
 * The shape under world point ([x], [y]), [slop] world units of grace included, as the web resolves
 * it (`hitTest` in `map-renderer.ts`): a station's marker beats a hub's region, which beats a name,
 * however much closer the lower tier is. A hub region holds its members' markers, and a name
 * routinely covers other stations' markers. Within a tier the nearest wins.
 *
 * A name resolves to the marker of the station it names ([labelAnchor]), or stands in for one when
 * none is drawn.
 */
fun hitTest(x: Double, y: Double, points: List<MapPoint>, labels: List<MapPoint>, slop: Double): MapHit? {
    var station: MapPoint? = null
    var stationDist = Double.POSITIVE_INFINITY
    var hub: MapPoint? = null
    var hubDist = Double.POSITIVE_INFINITY
    var label: MapPoint? = null
    var labelDist = Double.POSITIVE_INFINITY
    for (point in points.asSequence() + labels.asSequence()) {
        val effective = point.signedDistance(x, y) - slop
        if (effective > 0) continue
        when {
            point.isLabel -> if (effective < labelDist) {
                labelDist = effective
                label = point
            }

            point.isHub -> if (effective < hubDist) {
                hubDist = effective
                hub = point
            }

            effective < stationDist -> {
                stationDist = effective
                station = point
            }
        }
    }
    return when {
        station != null -> MapHit.Station(station)
        hub != null -> MapHit.Hub(hub)
        label != null -> MapHit.Station(labelAnchor(label, points))
        else -> null
    }
}

/**
 * The marker [label] names: the nearest drawn shape of its station, as a halte can be drawn twice
 * and a name belongs to the one it sits beside. [label] itself when no marker resolves, so the tap
 * still opens its station.
 */
fun labelAnchor(label: MapPoint, points: List<MapPoint>): MapPoint =
    points
        .filter { !it.isLabel && !it.isHub && it.stationId == label.stationId }
        .minByOrNull { hypot(it.centerX - label.centerX, it.centerY - label.centerY) }
        ?: label

/** `OPERATOR-CODE`, as the app's station ids are: an operator, a hyphen, a code. */
private val STATION_ID = Regex("^[A-Z]+-[A-Z0-9]+$")

/**
 * Whether [this] can stand in for the map's tap targets: authored for [edition], with something in
 * it, and every non-hub shape opening a station id the app can open. A copy that isn't is an edit
 * gone wrong, or an edition the tiles on screen don't show.
 */
fun MapPoints.isUsableFor(edition: String): Boolean =
    version == edition && points.isNotEmpty() && points.all { it.isHub || STATION_ID.matches(it.stationId) }
