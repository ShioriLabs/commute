package id.shiorilabs.commute.feature.map.domain

import id.shiorilabs.commute.core.geo.GeoPoint
import id.shiorilabs.commute.core.geo.decodePolyline
import id.shiorilabs.commute.core.geo.distanceM
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.double
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray

/**
 * Peta Bus: every TransJakarta line on its streets, the web's `app/data/bus-map.json` as bundled,
 * generated from the TransJakarta GTFS by `pnpm --filter api generate:bus-map`. Mirrors
 * `apps/web/app/lib/bus-map.ts`; change them together.
 */
@Serializable
data class BusMap(
    val attribution: String,
    val lines: List<BusMapLine>,
    /** The lines as one network: each street once, its lines left to right along it. What's drawn. */
    val edges: List<BusMapEdge> = emptyList(),
    /** Halte code → `[name, lng, lat]`. `TJ-$code` is the API's station id. */
    val haltes: Map<String, JsonArray>,
    /** Rail stations, as dots for bearings: `[station id, lng, lat]`. */
    val rail: List<JsonArray>,
)

@Serializable
data class BusMapLine(
    val code: String,
    val name: String,
    /** `BRT` for a koridor, `AUI` for Angkutan Umum Integrasi (the non-BRT lines). */
    val kind: String,
    /** `#RRGGBB`, the feed's route colour. */
    val color: String,
    /** Encoded polylines (Google, precision 5): the pieces that together draw the line once, as the feed has them. */
    val shapes: List<String>,
    /** [shapes] laid onto the roads themselves: what the line is drawn with. */
    val drawn: List<String> = emptyList(),
    /** Halte codes the line calls at. */
    val stops: List<String>,
)

/**
 * One street of the network, the generator's `busMapBundle.ts`: lines sharing it are drawn side by
 * side, as Transit draws them, in [lines]' order from left to right along [shape]'s direction.
 */
@Serializable
data class BusMapEdge(
    /** Encoded polyline (Google, precision 5). */
    val shape: String,
    /** Line codes, left to right along [shape]. */
    val lines: List<String>,
)

/** Line [index] of [count] on an edge: its offset in line widths, right of the edge's direction. */
fun edgeSlot(index: Int, count: Int): Double = index - (count - 1) / 2.0

/**
 * A trunk koridor: a plain-number BRT (`1` … `14`), and L13E. Zoomed out, the streets layer draws
 * only these, as the city's network, the branches and feeders coming in closer.
 */
fun isTrunk(code: String): Boolean = code == "L13E" || (code.isNotEmpty() && code.all(Char::isDigit))

/** A halte: its station id (`TJ-…`), name and place. */
data class BusMapHalte(val stationId: String, val name: String, val lng: Double, val lat: Double)

fun BusMap.haltes(): List<BusMapHalte> = haltes.map { (code, entry) ->
    BusMapHalte(
        stationId = "TJ-$code",
        name = entry[0].jsonPrimitive.content,
        lng = entry[1].jsonPrimitive.double,
        lat = entry[2].jsonPrimitive.double,
    )
}

/** Each halte's station id to the codes of the lines calling at it, in the order lines are listed. */
fun BusMap.linesByHalte(): Map<String, List<String>> {
    val out = LinkedHashMap<String, MutableList<String>>()
    for (line in lines) {
        for (stop in line.stops.distinct()) out.getOrPut("TJ-$stop") { mutableListOf() } += line.code
    }
    return out
}

/** A station the streets layer draws a dot for: a halte, or a rail station. */
data class GeoStop(val stationId: String, val lat: Double, val lng: Double)

/** Every dot the streets layer draws, haltes kept by [tappable] as [toGeoJson] keeps them. */
fun BusMap.stops(tappable: ((stationId: String) -> Boolean)? = null): List<GeoStop> =
    haltes().filter { tappable == null || tappable(it.stationId) }.map { GeoStop(it.stationId, it.lat, it.lng) } +
        rail.map { GeoStop(it[0].jsonPrimitive.content, it[2].jsonPrimitive.double, it[1].jsonPrimitive.double) }

/**
 * What "Sekitar" lists for the streets layer: the [stops] inside the box [south]..[north] by
 * [west]..[east] (what shows above the sheet), nearest ([centreLat], [centreLng]) first, [limit] at
 * most, a station once.
 */
fun stopsInView(
    stops: List<GeoStop>,
    south: Double,
    west: Double,
    north: Double,
    east: Double,
    centreLat: Double,
    centreLng: Double,
    limit: Int,
): List<String> {
    val centre = GeoPoint(centreLat, centreLng)
    return stops.asSequence()
        .filter { it.lat in south..north && it.lng in west..east }
        .map { it.stationId to distanceM(centre, GeoPoint(it.lat, it.lng)) }
        .sortedBy { it.second }
        .map { it.first }
        .distinct()
        .take(limit)
        .toList()
}

/** The streets layer's three sources, as GeoJSON FeatureCollection text MapLibre reads as is. */
/**
 * The streets layer's sources: [lines] the bundled network (each street once, its lines side by
 * side), [routes] every line on its own street geometry (street zoom, and a line alone), [haltes]
 * and [rail] the dots.
 */
data class BusMapGeoJson(val lines: String, val routes: String, val haltes: String, val rail: String)

/** GeoJSON properties the streets layer's style expressions and taps read. */
object BusMapProps {
    const val COLOR = "color"
    const val KIND = "kind"
    const val CODE = "code"
    const val STATION_ID = "id"
    const val NAME = "name"
    const val LINES = "lines"

    /** A line stretch's place across its street, in line widths to the right of its direction. */
    const val SLOT = "slot"

    /** A trunk koridor's place among the trunks alone on its street, for the zoomed-out network. */
    const val TRUNK_SLOT = "trunkSlot"
}

/**
 * [BusMap] as GeoJSON: a LineString per shape piece, a Point per halte and per rail station.
 * [tappable] keeps a halte only if its station id has a page to open: some haltes are routing-only
 * stops the station directory leaves out, and a tap on one would open nothing. With it null, every
 * halte is kept.
 */
fun BusMap.toGeoJson(tappable: ((stationId: String) -> Boolean)? = null): BusMapGeoJson {
    // Every edge once per line on it, each at its slot across the street; a trunk also at its slot
    // among the trunks alone, closed up for when the others aren't drawn.
    val byCode = lines.associateBy { it.code }
    val lineFeatures = buildJsonArray {
        for (edge in edges) {
            val points = decodePolyline(edge.shape)
            if (points.size < 2) continue
            val geometry = buildJsonObject {
                put("type", "LineString")
                putJsonArray("coordinates") {
                    for (p in points) add(buildJsonArray { add(p.longitude); add(p.latitude) })
                }
            }
            val trunks = edge.lines.filter(::isTrunk)
            for ((index, code) in edge.lines.withIndex()) {
                val line = byCode[code] ?: continue
                add(
                    feature(
                        geometry = geometry,
                        properties = buildJsonObject {
                            put(BusMapProps.CODE, line.code)
                            put(BusMapProps.KIND, line.kind)
                            put(BusMapProps.COLOR, line.color)
                            put(BusMapProps.SLOT, edgeSlot(index, edge.lines.size))
                            if (isTrunk(code)) put(BusMapProps.TRUNK_SLOT, edgeSlot(trunks.indexOf(code), trunks.size))
                        },
                    ),
                )
            }
        }
    }
    val calling = linesByHalte()
    val halteFeatures = buildJsonArray {
        for (halte in haltes()) {
            if (tappable != null && !tappable(halte.stationId)) continue
            add(
                feature(
                    geometry = point(halte.lng, halte.lat),
                    properties = buildJsonObject {
                        put(BusMapProps.STATION_ID, halte.stationId)
                        put(BusMapProps.NAME, halte.name)
                        put(BusMapProps.LINES, calling[halte.stationId].orEmpty().joinToString(" "))
                    },
                ),
            )
        }
    }
    val railFeatures = buildJsonArray {
        for (entry in rail) {
            add(
                feature(
                    geometry = point(entry[1].jsonPrimitive.double, entry[2].jsonPrimitive.double),
                    properties = buildJsonObject { put(BusMapProps.STATION_ID, entry[0].jsonPrimitive.content) },
                ),
            )
        }
    }
    // Every line on its own geometry, one LineString per shape piece.
    val routeFeatures = buildJsonArray {
        for (line in lines) {
            for (shape in line.drawnShapes) {
                val points = decodePolyline(shape)
                if (points.size < 2) continue
                add(
                    feature(
                        geometry = buildJsonObject {
                            put("type", "LineString")
                            putJsonArray("coordinates") {
                                for (p in points) add(buildJsonArray { add(p.longitude); add(p.latitude) })
                            }
                        },
                        properties = buildJsonObject {
                            put(BusMapProps.CODE, line.code)
                            put(BusMapProps.KIND, line.kind)
                            put(BusMapProps.COLOR, line.color)
                        },
                    ),
                )
            }
        }
    }
    return BusMapGeoJson(
        lines = collection(lineFeatures).toString(),
        routes = collection(routeFeatures).toString(),
        haltes = collection(halteFeatures).toString(),
        rail = collection(railFeatures).toString(),
    )
}

private fun point(lng: Double, lat: Double): JsonObject = buildJsonObject {
    put("type", "Point")
    putJsonArray("coordinates") {
        add(lng)
        add(lat)
    }
}

private fun feature(geometry: JsonObject, properties: JsonObject): JsonObject = buildJsonObject {
    put("type", "Feature")
    put("geometry", geometry)
    put("properties", properties)
}

private fun collection(features: JsonArray): JsonObject = buildJsonObject {
    put("type", "FeatureCollection")
    put("features", features)
}

/** A line as the streets layer shows it alone: its name, colour, and where it reaches. */
data class BusMapLineInfo(
    val code: String,
    val name: String,
    val color: String,
    val south: Double,
    val west: Double,
    val north: Double,
    val east: Double,
)

/** Each line's [BusMapLineInfo], by code: what a line picked on the streets layer shows and frames. */
fun BusMap.lineInfo(): Map<String, BusMapLineInfo> = lines.associate { line ->
    var south = Double.MAX_VALUE
    var west = Double.MAX_VALUE
    var north = -Double.MAX_VALUE
    var east = -Double.MAX_VALUE
    for (shape in line.drawnShapes) {
        for (p in decodePolyline(shape)) {
            south = minOf(south, p.latitude)
            north = maxOf(north, p.latitude)
            west = minOf(west, p.longitude)
            east = maxOf(east, p.longitude)
        }
    }
    line.code to BusMapLineInfo(line.code, line.name, line.color, south, west, north, east)
}

/** The pieces the line is drawn with: on the roads when the file has them, else as the feed has them. */
val BusMapLine.drawnShapes: List<String> get() = drawn.ifEmpty { shapes }
