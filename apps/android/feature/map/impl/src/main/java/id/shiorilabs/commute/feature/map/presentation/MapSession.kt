package id.shiorilabs.commute.feature.map.presentation

import android.graphics.Bitmap
import id.shiorilabs.commute.feature.map.domain.Transform
import kotlinx.coroutines.flow.MutableStateFlow
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Where the map was left, for as long as the app runs: a closed map reopens on the same place, and
 * grows out of home's rail card already showing it. In memory only; a fresh start opens on
 * Manggarai.
 */
@Singleton
class MapSession @Inject constructor() {

    /** Where the camera was when the map last left the screen. */
    var camera: Transform? = null

    /** The map as it looked then. */
    var snapshot: Bitmap? = null

    /** Where the streets layer's camera was when it last left the screen. */
    var streetsCamera: StreetsCamera? = null

    /** The debug panel's pick: how the streets layer draws its lines. */
    val streetsLines = MutableStateFlow(StreetsLines.ADJUSTED)

    /** The debug panel's pick: which of the streets layer's halte and station marks show. */
    val streetsDots = MutableStateFlow(StreetsDots.ALL)

    /** The debug panel's pick: the streets layer's lines zoomed out bundled, or as at street zoom. */
    val streetsOverview = MutableStateFlow(StreetsOverview.BUNDLED)
}

/** How the streets layer draws its lines below street zoom, picked in the map's debug panel. */
enum class StreetsOverview {
    /** Bundled side by side, as Transit draws them: the map as it shows. */
    BUNDLED,

    /** Each line on its own streets at every zoom, as at street zoom. */
    ROUTES,
}

/** Which marks the streets layer draws, picked in the map's debug panel. */
enum class StreetsDots(val haltes: Boolean, val stations: Boolean) {
    ALL(haltes = true, stations = true),
    HALTES(haltes = true, stations = false),
    STATIONS(haltes = false, stations = true),
    NONE(haltes = false, stations = false),
}

/** How the streets layer draws Peta Bus's lines, picked in the map's debug panel. */
enum class StreetsLines {
    /** Every shape the GTFS feed has, whole and untouched. */
    RAW,

    /** The generator's shapes: the feed along each koridor's route, before the roads and bundling. */
    PROCESSED,

    /** Laid on the roads and bundled: the map as it shows. */
    ADJUSTED,
}

/** The streets layer's camera, in MapLibre's terms but free of its types. */
data class StreetsCamera(val latitude: Double, val longitude: Double, val zoom: Double, val bearing: Double = 0.0)
