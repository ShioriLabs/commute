package id.shiorilabs.commute.feature.map.domain

/** What the map's sheet shows, the web's detail surface: one at a time. */
sealed interface MapSelection {

    /** A station or hub: its [point] spotlit and flown to. */
    sealed interface Spotlit : MapSelection {
        val point: MapPoint
    }

    /** A station's marker, or a name resolved to the marker it names. */
    data class Station(val stationId: String, override val point: MapPoint) : Spotlit

    /** A hub's region, by the [slug] its page opens by. */
    data class Hub(val slug: String, override val point: MapPoint) : Spotlit

    /**
     * A [line] isolated, the rest of the network faded. [fromStationId] is the station whose sheet
     * it was opened from, for its sheet's way back; null when tapped on the artwork.
     */
    data class Line(val line: MapLine, val fromStationId: String? = null) : MapSelection

    /** OTW's planner or a journey's page, the route drawn over the map. */
    data object Route : MapSelection
}

/** The drawn marker of station [stationId]: the first, for a halte drawn twice. */
fun List<MapPoint>.markerOf(stationId: String): MapPoint? = firstOrNull { !it.isHub && !it.isLabel && it.stationId == stationId }
