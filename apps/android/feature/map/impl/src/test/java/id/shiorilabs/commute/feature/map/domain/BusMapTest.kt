package id.shiorilabs.commute.feature.map.domain

import id.shiorilabs.commute.core.geo.decodePolyline
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.double
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class BusMapTest {

    private val busMap get() = WebMapData.busMap

    private fun features(text: String): List<JsonObject> =
        Json.parseToJsonElement(text).jsonObject["features"]!!.jsonArray.map { it.jsonObject }

    private fun JsonObject.prop(name: String): String = this["properties"]!!.jsonObject[name]!!.jsonPrimitive.content

    /** Whether [edge] crosses Thamrin between Bundaran HI and Sarinah (-6.1875), on the avenue. */
    private fun crossesMidThamrin(edge: BusMapEdge): Boolean =
        id.shiorilabs.commute.core.geo.decodePolyline(edge.shape).zipWithNext().any { (a, b) ->
            (a.latitude - -6.1875) * (b.latitude - -6.1875) <= 0.0 && a.longitude in 106.8215..106.8255
        }

    @Test
    fun `the shipped Peta Bus reads whole`() {
        assertTrue(busMap.lines.size > 50)
        assertTrue(busMap.haltes.size > 1000)
        assertTrue(busMap.rail.size > 100)
        assertTrue(busMap.lines.any { it.kind == "BRT" } && busMap.lines.any { it.kind == "AUI" })
    }

    @Test
    fun `every line piece lies in Jabodetabek`() {
        val geoJson = busMap.toGeoJson()
        val lines = features(geoJson.lines)
        assertTrue(lines.size >= busMap.lines.size)
        for (line in lines) {
            val coordinates = line["geometry"]!!.jsonObject["coordinates"]!!.jsonArray
            assertTrue(coordinates.size >= 2)
            for (c in coordinates) {
                val (lng, lat) = (c as JsonArray).map { it.jsonPrimitive.double }
                assertTrue("lng $lng", lng in 105.9..107.3)
                assertTrue("lat $lat", lat in -6.8..-5.85)
            }
            assertTrue(line.prop(BusMapProps.COLOR).matches(Regex("#[0-9A-Fa-f]{6}")))
        }
    }

    @Test
    fun `street zoom draws each trunk line laid on the roads, read at its own precision`() {
        val routes = features(busMap.toGeoJson().routes)
        assertEquals(busMap.lines.filter { isTrunk(it.code) }.sumOf { line -> line.drawn.size }, routes.size)
        for (route in routes) {
            for (c in route["geometry"]!!.jsonObject["coordinates"]!!.jsonArray) {
                val (lng, lat) = (c as JsonArray).map { it.jsonPrimitive.double }
                assertTrue("lng $lng", lng in 105.9..107.3)
                assertTrue("lat $lat", lat in -6.8..-5.85)
            }
        }
    }

    @Test
    fun `processed draws each trunk line's shapes, not its pieces laid on the roads`() {
        val processed = features(busMap.toGeoJson().processed)
        val trunks = busMap.lines.filter { isTrunk(it.code) }
        assertEquals(trunks.sumOf { line -> line.shapes.count { decodePolyline(it).size >= 2 } }, processed.size)
        val nine = trunks.first { it.code == "9" }
        val first = processed.first { it.prop(BusMapProps.CODE) == "9" }
        val coordinates = first["geometry"]!!.jsonObject["coordinates"]!!.jsonArray
        val shape = decodePolyline(nine.shapes.first())
        assertEquals(shape.size, coordinates.size)
        assertEquals(shape.first().longitude, (coordinates.first() as JsonArray)[0].jsonPrimitive.double, 1e-9)
        assertEquals(nine.color, first.prop(BusMapProps.COLOR))
    }

    @Test
    fun `raw draws every feed shape of each trunk line whole, in the line's colour`() {
        val feed = WebMapData.busMapFeed
        val raw = features(busMap.feedGeoJson(feed))
        val trunks = busMap.lines.filter { isTrunk(it.code) }.map { it.code }.toSet()
        val fed = feed.lines.filter { it.code in trunks }
        assertEquals(fed.sumOf { line -> line.shapes.count { decodePolyline(it).size >= 2 } }, raw.size)
        // 9 runs several patterns in the feed (short turns, the Pluit loop): every one is drawn.
        val nine = fed.first { it.code == "9" }
        assertTrue(nine.shapes.size > busMap.lines.first { it.code == "9" }.shapes.size)
        assertEquals(nine.shapes.size, raw.count { it.prop(BusMapProps.CODE) == "9" })
        assertTrue(raw.all { it.prop(BusMapProps.CODE) in trunks })
        assertEquals(busMap.lines.first { it.code == "9" }.color, raw.first { it.prop(BusMapProps.CODE) == "9" }.prop(BusMapProps.COLOR))
    }

    @Test
    fun `haltes carry their station ids and the lines calling there`() {
        val haltes = features(busMap.toGeoJson().haltes)
        assertEquals(busMap.haltes.size, haltes.size)
        assertTrue(haltes.all { it.prop(BusMapProps.STATION_ID).startsWith("TJ-") })
        val firstStop = "TJ-" + busMap.lines.first().stops.first()
        val halte = haltes.first { it.prop(BusMapProps.STATION_ID) == firstStop }
        assertTrue(busMap.lines.first().code in halte.prop(BusMapProps.LINES).split(' '))
    }

    @Test
    fun `haltes with no page are left off`() {
        val keep = busMap.haltes.keys.take(10).map { "TJ-$it" }.toSet()
        val haltes = features(busMap.toGeoJson(tappable = { it in keep }).haltes)
        assertEquals(keep, haltes.map { it.prop(BusMapProps.STATION_ID) }.toSet())
    }

    @Test
    fun `Sekitar lists the dots in view, nearest the middle first`() {
        val stops = listOf(
            GeoStop("TJ-FAR", lat = -6.20, lng = 106.84),
            GeoStop("TJ-NEAR", lat = -6.195, lng = 106.823),
            GeoStop("KCI-OUT", lat = -6.30, lng = 106.82),
            GeoStop("TJ-NEAR", lat = -6.1951, lng = 106.8231),
        )
        val ids = stopsInView(stops, south = -6.25, west = 106.80, north = -6.15, east = 106.85, centreLat = -6.195, centreLng = 106.823, limit = 6)
        assertEquals(listOf("TJ-NEAR", "TJ-FAR"), ids)
        assertEquals(listOf("TJ-NEAR"), stopsInView(stops, -6.25, 106.80, -6.15, 106.85, -6.195, 106.823, limit = 1))
    }

    @Test
    fun `the streets' dots are the haltes kept and every rail station`() {
        val keep = busMap.haltes.keys.take(3).map { "TJ-$it" }.toSet()
        val stops = busMap.stops(tappable = { it in keep })
        assertEquals(keep.size + busMap.openRail.size, stops.size)
        assertTrue(stops.all { it.lat in -6.8..-5.85 && it.lng in 105.9..107.3 })
    }

    @Test
    fun `the shipped network draws every trunk koridor and nothing else`() {
        val codes = busMap.lines.map { it.code }.toSet()
        assertTrue(busMap.edges.size > 100)
        assertTrue(busMap.edges.all { edge -> edge.lines.isNotEmpty() && edge.lines.all { it in codes } && edge.lines.distinct() == edge.lines })
        assertEquals(codes.filter(::isTrunk).toSet(), busMap.edges.flatMap { it.lines }.toSet())
    }

    @Test
    fun `a line on an edge sits at its own slot, centred on the street`() {
        assertEquals(0.0, edgeSlot(0, 1), 0.0)
        assertEquals(listOf(-1.0, 0.0, 1.0), (0 until 3).map { edgeSlot(it, 3) })
        assertEquals(listOf(-0.5, 0.5), (0 until 2).map { edgeSlot(it, 2) })
        // A rail line takes RAIL_LINE_WEIGHT of the room: 1 (1.0 wide) at -0.75, M (1.5) at 0.5 beside it.
        val lines = listOf(
            BusMapLine(code = "1", name = "", kind = "BRT", color = "#D62126", shapes = emptyList(), stops = emptyList()),
            BusMapLine(code = "MRTJ:M", name = "", kind = "RAIL", color = "#CA2A51", shapes = emptyList(), stops = emptyList()),
        ).associateBy { it.code }
        val strokes = strokesOf(listOf("1", "MRTJ:M"), 0.0, lines)
        assertEquals(listOf(-0.75, 0.5), strokes.map { it.slot })
        assertEquals(listOf(1.0, RAIL_LINE_WEIGHT), strokes.map { it.weight })
    }

    @Test
    fun `on Thamrin, koridor 1 is drawn, without the branches sharing its street`() {
        // Mid Thamrin, between Bundaran HI and Sarinah.
        val thamrin = busMap.edges.filter { crossesMidThamrin(it) }
        assertTrue(busMap.edges.any { edge -> "1" in edge.lines && crossesMidThamrin(edge) })
        assertTrue(thamrin.none { edge -> edge.lines.any { it == "6A" || it == "6B" } })
        val lines = features(busMap.toGeoJson().lines)
        val drawn = lines.count { it.prop(BusMapProps.CODE) == "1" }
        assertTrue(drawn >= busMap.edges.count { "1" in it.lines })
    }

    @Test
    fun `the trunks are the plain-number BRTs, L13E and the rail lines`() {
        assertTrue(listOf("1", "9", "13", "14", "13E", "L13E", "KCI:C", "MRTJ:M").all(::isTrunk))
        assertTrue(listOf("1A", "6B", "4D", "L13", "13B", "").none(::isTrunk))
        assertTrue(busMap.lines.filter { isTrunk(it.code) }.all { it.kind == "BRT" || (it.kind == "RAIL" && isRailLine(it.code)) })
    }

    @Test
    fun `rail lines are bundled with the koridors, MRT M beside 1 on Sudirman`() {
        val rail = busMap.lines.filter { it.kind == "RAIL" }
        assertTrue(rail.map { it.code }.containsAll(listOf("KCI:C", "KCI:B", "MRTJ:M", "LRTJBDB:BK", "LRTJBDB:CB")))
        assertTrue(rail.all { it.stops.isEmpty() && it.drawn.isNotEmpty() && it.color.startsWith("#") })
        assertTrue(busMap.edges.any { "MRTJ:M" in it.lines && "1" in it.lines })
        val drawn = features(busMap.toGeoJson().lines).filter { it.prop(BusMapProps.KIND) == "RAIL" }
        assertTrue(drawn.isNotEmpty())
        assertTrue(drawn.all { it["properties"]!!.jsonObject.containsKey(BusMapProps.TRUNK_SLOT) })
        assertEquals("TJ:1", lineKeyOf("1"))
        assertEquals("KCI:C", lineKeyOf("KCI:C"))
    }

    @Test
    fun `zoomed out, trunks close up among themselves on each street`() {
        val lines = features(busMap.toGeoJson().lines)
        val withTrunkSlot = lines.filter { it["properties"]!!.jsonObject.containsKey(BusMapProps.TRUNK_SLOT) }
        assertTrue(withTrunkSlot.isNotEmpty())
        assertTrue(withTrunkSlot.all { isTrunk(it.prop(BusMapProps.CODE)) })
        assertTrue(lines.filter { isTrunk(it.prop(BusMapProps.CODE)) }.size == withTrunkSlot.size)
        // Closed up: no trunk sits further out than its street's trunks alone reach, its bundle moved
        // across the street (a line width at most) aside.
        val widest = busMap.edges.maxOf { edge -> edge.lines.count(::isTrunk) }
        val reach = (widest - 1) / 2.0 + 1.0
        assertTrue(withTrunkSlot.all { kotlin.math.abs(it.prop(BusMapProps.TRUNK_SLOT).toDouble()) <= reach })
        // With only trunks on the network, a line's trunk slot is its slot.
        assertTrue(withTrunkSlot.all { it.prop(BusMapProps.TRUNK_SLOT) == it.prop(BusMapProps.SLOT) })
    }

    @Test
    fun `every halte placed on the network gets a mark, a bar for several lines and a coloured dot for one`() {
        // Only haltes on a drawn koridor have a line on the network to sit on.
        val onTrunks = busMap.lines.filter { isTrunk(it.code) }.flatMap { it.stops }.toSet()
        assertTrue(busMap.stopMarks.size > onTrunks.size * 9 / 10)
        val marks = features(busMap.toGeoJson().marks)
        assertEquals(busMap.stopMarks.size, marks.size)
        assertTrue(marks.all { it.prop(BusMapProps.STATION_ID).startsWith("TJ-") })
        val single = marks.filter { it.prop(BusMapProps.COUNT) == "1" }
        assertTrue(single.isNotEmpty() && single.all { it.prop(BusMapProps.COLOR).matches(Regex("#[0-9A-Fa-f]{6}")) })
    }

    @Test
    fun `a bundle moved across its street moves every line on it, and its halte bars`() {
        val shifted = BusMap(
            attribution = "",
            lines = listOf(
                BusMapLine(code = "1", name = "", kind = "BRT", color = "#D62126", shapes = emptyList(), stops = listOf("A")),
                BusMapLine(code = "13", name = "", kind = "BRT", color = "#7A3381", shapes = emptyList(), stops = listOf("A")),
            ),
            edges = listOf(BusMapEdge(shape = "_p~iF~ps|U_ulLnnqC", lines = listOf("1", "13"), shift = -0.5)),
            stopMarks = listOf(Json.parseToJsonElement("""["A", -120.2, 38.5, 90, 2, "", -0.5]""").jsonArray),
            haltes = emptyMap(),
            rail = emptyList(),
        ).toGeoJson()
        val slots = features(shifted.lines).associate { it.prop(BusMapProps.CODE) to it.prop(BusMapProps.SLOT).toDouble() }
        assertEquals(mapOf("1" to -1.0, "13" to 0.0), slots)
        val bar = features(shifted.marks).single()["properties"]!!.jsonObject[BusMapProps.BAR_OFFSET]!!.jsonArray
        assertEquals(listOf(-0.5 * BUS_LINE_W_15_DP, 0.0), bar.map { it.jsonPrimitive.double })
    }

    @Test
    fun `the 13s keep their place past CSW where 1 rides with them`() {
        // Trunojoyo east of CSW 1, where 1 joins 13, 13E and L13E for 400 m: each 13 lies where it
        // does on Trunojoyo's edges either side, right of the eastward way.
        fun eastward(edge: BusMapEdge): Boolean = id.shiorilabs.commute.core.geo.decodePolyline(edge.shape).let { it.last().longitude > it.first().longitude }
        fun place(edge: BusMapEdge, code: String): Double {
            val right = busMap.strokesOf(edge).first { code in it.codes }.slot
            return if (eastward(edge)) right else -right
        }
        val trunojoyo = busMap.edges.filter { edge ->
            "13" in edge.lines && id.shiorilabs.commute.core.geo.decodePolyline(edge.shape).any { it.latitude in -6.2410..-6.2390 && it.longitude in 106.795..106.806 }
        }
        val withOne = trunojoyo.filter { "1" in it.lines }
        assertTrue(withOne.isNotEmpty() && trunojoyo.size > withOne.size)
        for (code in listOf("13", "13E", "L13E")) assertEquals(1, trunojoyo.map { place(it, code) }.toSet().size)
    }

    @Test
    fun `a colour's lines are one stroke where they share a street, carrying every line for a tap`() {
        // The Ciledug busway: 13, 13E and L13E, one purple, drawn once.
        val busway = busMap.edges.filter { edge -> listOf("13", "13E", "L13E").all { it in edge.lines } }
        assertTrue(busway.isNotEmpty())
        val lines = features(busMap.toGeoJson().lines)
        for (edge in busway) {
            val strokes = busMap.strokesOf(edge)
            assertEquals(edge.lines.map { code -> busMap.lines.first { it.code == code }.color.uppercase() }.distinct().size, strokes.size)
            assertEquals(1, strokes.count { "13" in it.codes && "13E" in it.codes && "L13E" in it.codes })
        }
        val purple = lines.filter { it.prop(BusMapProps.LINES).split(' ').containsAll(listOf("13", "13E", "L13E")) }
        assertTrue(purple.isNotEmpty())
        // Lines of different colours stay strokes of their own.
        val mixed = strokesOf(listOf("1", "13", "13E"), 0.0, busMap.lines.associateBy { it.code })
        assertEquals(listOf(listOf("1"), listOf("13", "13E")), mixed.map { it.codes })
        assertEquals(listOf(-0.5, 0.5), mixed.map { it.slot })
    }

    @Test
    fun `rail stations keep their API ids`() {
        val rail = features(busMap.toGeoJson().rail)
        assertEquals(busMap.openRail.size, rail.size)
        assertTrue(rail.all { it.prop(BusMapProps.STATION_ID).contains('-') })
    }

    @Test
    fun `a closed rail station stays in the file but off the map`() {
        assertTrue(busMap.rail.any { it[0].jsonPrimitive.content == "KCI-KAT" })
        assertTrue(features(busMap.toGeoJson().rail).none { it.prop(BusMapProps.STATION_ID) == "KCI-KAT" })
        assertTrue(busMap.stops().none { it.stationId == "KCI-KAT" })
    }

    @Test
    fun `rail stations are shirase's station kind, named from the directory where it knows them`() {
        val named = busMap.openRail.first()[0].jsonPrimitive.content
        val rail = features(busMap.toGeoJson(railNames = mapOf(named to "Sudirman")).rail)
        assertTrue(rail.all { it.prop(BusMapProps.KIND) == RAIL_POI_KIND })
        val (withName, without) = rail.partition { it["properties"]!!.jsonObject.containsKey(BusMapProps.NAME) }
        assertEquals(listOf(named), withName.map { it.prop(BusMapProps.STATION_ID) })
        assertEquals("Sudirman", withName.single().prop(BusMapProps.NAME))
        assertEquals(busMap.openRail.size - 1, without.size)
    }

    @Test
    fun `a rail station's roundels are its numbers, a line apiece, one image per set`() {
        val manggarai = busMap.rail.single { it[0].jsonPrimitive.content == "KCI-MRI" }
        assertEquals(
            listOf(RailNumber("KCI:C", "C13"), RailNumber("KCI:B", "B09"), RailNumber("KCI:A", "A03")),
            railNumbersOf(manggarai),
        )
        val rail = features(busMap.toGeoJson().rail).associateBy { it.prop(BusMapProps.STATION_ID) }
        assertEquals(railRoundelImage(railNumbersOf(manggarai)), rail.getValue("KCI-MRI").prop(BusMapProps.ICON))
        assertEquals("3", rail.getValue("KCI-MRI").prop(BusMapProps.COUNT))
        // Kept zoomed out: Manggarai, an interchange, and Bogor, a line's end; not Sudirman.
        assertEquals("true", rail.getValue("KCI-MRI").prop(BusMapProps.MAJOR))
        assertEquals("true", rail.getValue("KCI-BOO").prop(BusMapProps.MAJOR))
        assertEquals("false", rail.getValue("KCI-SUD").prop(BusMapProps.MAJOR))
        val roundels = busMap.railRoundels()
        assertTrue(rail.values.all { it.prop(BusMapProps.ICON) in roundels })
        assertEquals(emptyList<RailNumber>(), railNumbersOf(JsonArray(manggarai.take(3))))
        assertEquals(RAIL_PLAIN_IMAGE, railRoundelImage(emptyList()))
    }
}
