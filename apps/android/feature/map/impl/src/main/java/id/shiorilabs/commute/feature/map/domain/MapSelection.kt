package id.shiorilabs.commute.feature.map.domain

/**
 * What the map's sheet shows, the web's detail surface: one at a time, its [point] spotlit and
 * flown to.
 */
sealed interface MapSelection {

    val point: MapPoint

    /** A station's marker, or a name resolved to the marker it names. */
    data class Station(val stationId: String, override val point: MapPoint) : MapSelection

    /** A hub's region, by the [slug] its page opens by. */
    data class Hub(val slug: String, override val point: MapPoint) : MapSelection
}

/** The drawn marker of station [stationId]: the first, for a halte drawn twice. */
fun List<MapPoint>.markerOf(stationId: String): MapPoint? = firstOrNull { !it.isHub && !it.isLabel && it.stationId == stationId }
