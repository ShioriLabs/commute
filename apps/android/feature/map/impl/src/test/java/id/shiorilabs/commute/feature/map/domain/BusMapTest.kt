package id.shiorilabs.commute.feature.map.domain

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
        assertEquals(keep.size + busMap.rail.size, stops.size)
        assertTrue(stops.all { it.lat in -6.8..-5.85 && it.lng in 105.9..107.3 })
    }

    @Test
    fun `the shipped network draws every line, on edges that name only known lines`() {
        val codes = busMap.lines.map { it.code }.toSet()
        assertTrue(busMap.edges.size > 500)
        assertTrue(busMap.edges.all { edge -> edge.lines.isNotEmpty() && edge.lines.all { it in codes } && edge.lines.distinct() == edge.lines })
        assertEquals(codes, busMap.edges.flatMap { it.lines }.toSet())
    }

    @Test
    fun `a line on an edge sits at its own slot, centred on the street`() {
        assertEquals(0.0, edgeSlot(0, 1), 0.0)
        assertEquals(listOf(-1.0, 0.0, 1.0), (0 until 3).map { edgeSlot(it, 3) })
        assertEquals(listOf(-0.5, 0.5), (0 until 2).map { edgeSlot(it, 2) })
    }

    @Test
    fun `on Thamrin, koridor 1 shares its street with 6A and 6B side by side`() {
        // Mid Thamrin, between Bundaran HI and Sarinah.
        val thamrin = busMap.edges.filter { edge ->
            id.shiorilabs.commute.core.geo.decodePolyline(edge.shape).any { it.latitude in -6.1885..-6.1865 && it.longitude in 106.8225..106.8245 }
        }
        assertTrue(thamrin.any { edge -> edge.lines.containsAll(listOf("1", "6A", "6B")) })
        val lines = features(busMap.toGeoJson().lines)
        val drawn = lines.count { it.prop(BusMapProps.CODE) == "1" }
        assertTrue(drawn >= busMap.edges.count { "1" in it.lines })
    }

    @Test
    fun `rail stations keep their API ids`() {
        val rail = features(busMap.toGeoJson().rail)
        assertEquals(busMap.rail.size, rail.size)
        assertTrue(rail.all { it.prop(BusMapProps.STATION_ID).contains('-') })
    }
}
