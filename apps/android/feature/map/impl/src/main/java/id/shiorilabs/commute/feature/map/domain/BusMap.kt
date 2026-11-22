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
import kotlinx.serialization.json.int
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
    /** Each halte on the network: `[code, lng, lat, bearing, line count, its one line]`, for its mark across the bundle. */
    val stopMarks: List<JsonArray> = emptyList(),
    /** Halte code → `[name, lng, lat]`. `TJ-$code` is the API's station id. */
    val haltes: Map<String, JsonArray>,
    /**
     * Rail stations: `[station id, lng, lat, numbers]`, the numbers `[line key, station number]` a
     * line apiece (`["KCI:C", "C12"]`), for its roundels. An older file has no numbers.
     */
    val rail: List<JsonArray>,
)

/**
 * Every line's shapes as the GTFS feed has them, each distinct one whole and untouched: the web's
 * `app/data/bus-map-feed.json`, for the map's debug panel (Raw). Written beside Peta Bus by the
 * same generator run.
 */
@Serializable
data class BusMapFeed(val lines: List<BusMapFeedLine>)

@Serializable
data class BusMapFeedLine(
    val code: String,
    /** Encoded polylines (Google, precision 5), a feed shape apiece. */
    val shapes: List<String>,
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
    /** [shapes] laid onto the roads themselves: what the line is drawn with. Precision 6 ([DRAWN_PRECISION]). */
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
    /**
     * The whole bundle moved this many line widths right of [shape], so lines going straight on
     * through a node keep their place where a line joins or leaves (the 13s past CSW as 1 joins).
     */
    val shift: Double = 0.0,
)

/** Line [index] of [count] on an edge: its offset in line widths, right of the edge's direction. */
fun edgeSlot(index: Int, count: Int): Double = index - (count - 1) / 2.0

/**
 * One stroke across an edge: its lines of one colour, drawn as one line width, as Transit draws New
 * York's A, C and E as one blue (13, 13E and L13E, one purple, along the Ciledug busway), at [slot]
 * line widths right of the edge's way, its bundle's shift added.
 */
data class BusMapStroke(val codes: List<String>, val color: String, val kind: String, val slot: Double)

/**
 * [codes]' strokes left to right, each run of one colour in them drawn once (the generator puts a
 * colour's lines side by side: `strokeKeys` in busMapBundle.ts), [shift] added. A code [byCode]
 * doesn't know is left out.
 */
fun strokesOf(codes: List<String>, shift: Double, byCode: Map<String, BusMapLine>): List<BusMapStroke> {
    val runs = mutableListOf<MutableList<BusMapLine>>()
    for (code in codes) {
        val line = byCode[code] ?: continue
        val run = runs.lastOrNull()
        if (run != null && run.first().color.equals(line.color, ignoreCase = true)) run += line else runs += mutableListOf(line)
    }
    return runs.mapIndexed { i, run ->
        BusMapStroke(
            codes = run.map { it.code },
            color = run.first().color,
            kind = if (run.any { it.kind == "BRT" }) "BRT" else run.first().kind,
            slot = edgeSlot(i, runs.size) + shift,
        )
    }
}

/** [edge]'s strokes left to right (see [strokesOf]). */
fun BusMap.strokesOf(edge: BusMapEdge, byCode: Map<String, BusMapLine> = lines.associateBy { it.code }): List<BusMapStroke> =
    strokesOf(edge.lines, edge.shift, byCode)

/**
 * A line's width at z15, in dp: what the streets layer draws lines at there, and the unit a halte
 * bar's [BusMapProps.BAR_OFFSET] is given in, the bar being drawn for that width and scaled with it.
 */
const val BUS_LINE_W_15_DP = 3.5f

/**
 * A trunk koridor: a plain-number BRT (`1` … `14`), and 13E and L13E. The streets layer draws only
 * these for now, at every zoom (the generator bundles only these too: `isDrawn` in busMapBundle.ts).
 */
fun isTrunk(code: String): Boolean = code == "L13E" || code == "13E" || (code.isNotEmpty() && code.all(Char::isDigit))

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

/**
 * Rail stations closed for good, left off the map. The file keeps them, as the coordinate CSV does,
 * for the record. Karet (`KCI-KAT`) is closed.
 */
val CLOSED_RAIL_STATIONS = setOf("KCI-KAT")

/** The rail stations the map draws: the file's, less [CLOSED_RAIL_STATIONS]. */
val BusMap.openRail: List<JsonArray>
    get() = rail.filter { it[0].jsonPrimitive.content !in CLOSED_RAIL_STATIONS }

/** A rail station's number on one of its lines: [lineKey] `KCI:C`, [number] `C12`. */
data class RailNumber(val lineKey: String, val number: String)

/** A rail station's numbers, a line apiece in the topology's order; none for an unnumbered one. */
fun railNumbersOf(entry: JsonArray): List<RailNumber> =
    (entry.getOrNull(3) as? JsonArray).orEmpty().mapNotNull { pair ->
        val both = pair as? JsonArray ?: return@mapNotNull null
        if (both.size < 2) return@mapNotNull null
        RailNumber(both[0].jsonPrimitive.content, both[1].jsonPrimitive.content)
    }

/** The image a rail station's roundels are drawn from: one per set of numbers, shared by none else. */
fun railRoundelImage(numbers: List<RailNumber>): String =
    if (numbers.isEmpty()) RAIL_PLAIN_IMAGE else RAIL_ROUNDEL_IMAGE + numbers.joinToString("+") { it.number }

/** Every rail roundel image the stations need, each with the numbers it draws. */
fun BusMap.railRoundels(): Map<String, List<RailNumber>> =
    openRail.map(::railNumbersOf).associateBy(::railRoundelImage)

private const val RAIL_ROUNDEL_IMAGE = "rail-roundel-"

/** An unnumbered station's mark: a plain ring. */
const val RAIL_PLAIN_IMAGE = "rail-plain"

/** A station the streets layer draws a dot for: a halte, or a rail station. */
data class GeoStop(val stationId: String, val lat: Double, val lng: Double)

/** Every dot the streets layer draws, haltes kept by [tappable] as [toGeoJson] keeps them. */
fun BusMap.stops(tappable: ((stationId: String) -> Boolean)? = null): List<GeoStop> =
    haltes().filter { tappable == null || tappable(it.stationId) }.map { GeoStop(it.stationId, it.lat, it.lng) } +
        openRail.map { GeoStop(it[0].jsonPrimitive.content, it[2].jsonPrimitive.double, it[1].jsonPrimitive.double) }

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

/**
 * The streets layer's sources, as GeoJSON FeatureCollection text MapLibre reads as is: [lines] the
 * bundled network (each street once, its lines side by side), [routes] every line on its own street
 * geometry (street zoom, and a line alone), [haltes] and [rail] the dots, [marks] each halte on its
 * bundle, and [processed] every line's [BusMapLine.shapes], before they are laid on the roads and
 * bundled, for the map's debug panel.
 */
data class BusMapGeoJson(
    val lines: String,
    val routes: String,
    val haltes: String,
    val rail: String,
    val marks: String = "",
    val processed: String = "",
)

/** shirase's POI kind for a rail station (its `pois` layer, apps/shirase/src/pois.json). */
const val RAIL_POI_KIND = "station"

/** GeoJSON properties the streets layer's style expressions and taps read. */
object BusMapProps {
    const val COLOR = "color"
    const val KIND = "kind"
    const val CODE = "code"
    const val STATION_ID = "id"
    const val NAME = "name"
    const val LINES = "lines"

    /** A rail station's roundel image ([railRoundelImage]). */
    const val ICON = "icon"

    /** A line stretch's place across its street, in line widths to the right of its direction. */
    const val SLOT = "slot"

    /** A trunk koridor's place among the trunks alone on its street, for the zoomed-out network. */
    const val TRUNK_SLOT = "trunkSlot"

    /** A halte mark's way across the street (degrees from north) and how many lines its bar spans. */
    const val BEARING = "bearing"
    const val COUNT = "count"

    /** A halte bar's `[x, 0]` offset in dp at z15, x right of the street's way: its bundle's shift. */
    const val BAR_OFFSET = "barOffset"
}

/**
 * [BusMap] as GeoJSON: a LineString per shape piece, a Point per halte and per rail station.
 * [tappable] keeps a halte only if its station id has a page to open: some haltes are routing-only
 * stops the station directory leaves out, and a tap on one would open nothing. With it null, every
 * halte is kept. A rail station is named from [railNames] by its station id, carries its roundels'
 * image ([railRoundelImage]), and shirase's own POI kind for one ([RAIL_POI_KIND]), so the
 * basemap's label colour for a station fits it.
 */
fun BusMap.toGeoJson(
    tappable: ((stationId: String) -> Boolean)? = null,
    railNames: Map<String, String> = emptyMap(),
): BusMapGeoJson {
    // Every edge once per stroke on it (a colour's lines are one: 13, 13E and L13E), each at its slot
    // across the street, carrying its lines for a tap to ask which; a trunk stroke also at its slot
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
            // Among the trunks alone the bundle is another one, centred, unless it is all trunks.
            val trunkStrokes = strokesOf(trunks, if (trunks.size == edge.lines.size) edge.shift else 0.0, byCode)
            for (stroke in strokesOf(edge, byCode)) {
                val trunkStroke = trunkStrokes.firstOrNull { trunk -> trunk.codes.any { it in stroke.codes } }
                add(
                    feature(
                        geometry = geometry,
                        properties = buildJsonObject {
                            put(BusMapProps.CODE, stroke.codes.first())
                            put(BusMapProps.LINES, stroke.codes.joinToString(" "))
                            put(BusMapProps.KIND, stroke.kind)
                            put(BusMapProps.COLOR, stroke.color)
                            put(BusMapProps.SLOT, stroke.slot)
                            if (trunkStroke != null) put(BusMapProps.TRUNK_SLOT, trunkStroke.slot)
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
        for (entry in openRail) {
            val stationId = entry[0].jsonPrimitive.content
            add(
                feature(
                    geometry = point(entry[1].jsonPrimitive.double, entry[2].jsonPrimitive.double),
                    properties = buildJsonObject {
                        put(BusMapProps.STATION_ID, stationId)
                        put(BusMapProps.KIND, RAIL_POI_KIND)
                        val numbers = railNumbersOf(entry)
                        put(BusMapProps.ICON, railRoundelImage(numbers))
                        // How many roundels across, for the name to clear them all.
                        put(BusMapProps.COUNT, numbers.size)
                        railNames[stationId]?.let { put(BusMapProps.NAME, it) }
                    },
                ),
            )
        }
    }
    // Each halte on its bundle: a bar across all the lines there, or a dot in its one line's colour.
    val markFeatures = buildJsonArray {
        for (mark in stopMarks) {
            val stationId = "TJ-${mark[0].jsonPrimitive.content}"
            if (tappable != null && !tappable(stationId)) continue
            val count = mark[4].jsonPrimitive.int
            val only = mark.getOrNull(5)?.jsonPrimitive?.content.orEmpty()
            val shift = mark.getOrNull(6)?.jsonPrimitive?.double ?: 0.0
            add(
                feature(
                    geometry = point(mark[1].jsonPrimitive.double, mark[2].jsonPrimitive.double),
                    properties = buildJsonObject {
                        put(BusMapProps.STATION_ID, stationId)
                        put(BusMapProps.BEARING, mark[3].jsonPrimitive.double)
                        put(BusMapProps.COUNT, count)
                        putJsonArray(BusMapProps.BAR_OFFSET) {
                            add(shift * BUS_LINE_W_15_DP)
                            add(0.0)
                        }
                        if (count == 1) byCode[only]?.let { put(BusMapProps.COLOR, it.color) }
                    },
                ),
            )
        }
    }
    return BusMapGeoJson(
        lines = collection(lineFeatures).toString(),
        // Every line on its own geometry, one LineString per piece: laid on the roads, and as the feed has it.
        routes = collection(pieceFeatures(lines.map { it to it.drawnPieces })).toString(),
        marks = collection(markFeatures).toString(),
        haltes = collection(halteFeatures).toString(),
        rail = collection(railFeatures).toString(),
        processed = collection(pieceFeatures(lines.map { line -> line to line.shapes.map { decodePolyline(it) } })).toString(),
    )
}

/**
 * [feed]'s shapes as GeoJSON for the streets layer: each trunk line's, a LineString apiece in the
 * line's colour, as [BusMapGeoJson.processed] is. A line [lines] doesn't know is left out.
 */
fun BusMap.feedGeoJson(feed: BusMapFeed): String {
    val byCode = lines.associateBy { it.code }
    return collection(pieceFeatures(feed.lines.mapNotNull { fed -> byCode[fed.code]?.let { line -> line to fed.shapes.map { decodePolyline(it) } } })).toString()
}

/** Each trunk line's pieces, a LineString apiece carrying its code, kind and colour. */
private fun pieceFeatures(pieces: List<Pair<BusMapLine, List<List<GeoPoint>>>>): JsonArray = buildJsonArray {
    for ((line, shapes) in pieces) {
        if (!isTrunk(line.code)) continue
        for (points in shapes) {
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
    for (piece in line.drawnPieces) {
        for (p in piece) {
            south = minOf(south, p.latitude)
            north = maxOf(north, p.latitude)
            west = minOf(west, p.longitude)
            east = maxOf(east, p.longitude)
        }
    }
    line.code to BusMapLineInfo(line.code, line.name, line.color, south, west, north, east)
}

/** The pieces the line is drawn with, decoded: on the roads when the file has them, else as the feed has them. */
val BusMapLine.drawnPieces: List<List<GeoPoint>>
    get() = if (drawn.isNotEmpty()) drawn.map { decodePolyline(it, DRAWN_PRECISION) } else shapes.map { decodePolyline(it) }

/** [BusMapLine.drawn]'s encoding: the generator's DRAWN_PRECISION, finer than the feed's 5 so a bend stays a curve. */
const val DRAWN_PRECISION = 6
