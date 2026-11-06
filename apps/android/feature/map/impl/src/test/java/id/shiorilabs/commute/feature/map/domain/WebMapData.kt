package id.shiorilabs.commute.feature.map.domain

import kotlinx.serialization.json.Json
import java.io.File

/** The web's shipped map data (`apps/web/app/data`), as the app bundles it. */
object WebMapData {

    private val json = Json { ignoreUnknownKeys = true }

    private fun read(name: String): String = File(System.getProperty("commute.webMapData"), name).readText()

    val corridors: MapCorridors by lazy { json.decodeFromString(MapCorridors.serializer(), read("map-corridors.json")) }
    val lines: MapLines by lazy { json.decodeFromString(MapLines.serializer(), read("map-lines.json")) }
    val points: MapPoints by lazy { json.decodeFromString(MapPoints.serializer(), read("points.json")) }
}
