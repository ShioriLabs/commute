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

    /** The debug panel's pick: lines on their own streets side by side where they share a lane, or one over another. */
    val streetsApart = MutableStateFlow(StreetsApart.SEPARATED)

    /** The debug panel's pick: whose network the streets layer draws. */
    val streetsCity = MutableStateFlow(StreetsCity.JAKARTA)

    /** The debug panel's pick: how heavy the streets layer's lines are drawn. */
    val streetsWeight = MutableStateFlow(StreetsWeight.NORMAL)

    /** The debug panel's pick: each line drawn on through the nodes, or each edge's lines on their own. */
    val streetsJoins = MutableStateFlow(StreetsJoins.CONTINUOUS)
}

/** How the streets layer joins its bundles' lines at the nodes, picked in the map's debug panel. */
enum class StreetsJoins {
    /** Each line one path through the network, easing over and rounding its corners: the map as it shows. */
    CONTINUOUS,

    /** Each edge's lines drawn on their own at its offset, ending at its nodes. */
    PIECES,
}

/** The streets layer's lines, their bundles' spacing and halte marks this many times as heavy, picked in the map's debug panel. */
enum class StreetsWeight(val scale: Float) {
    NORMAL(1f),
    HEAVIER(1.5f),
    DOUBLE(2f),
}

/**
 * Whose network the streets layer draws, picked in the map's debug panel: Peta Bus, or New York's
 * subway around Midtown West and Central Park run through Peta Bus's bundler (a debug build's
 * `bus-map-nyc.json`), to see the drawing on a network Transit's map is known for.
 */
enum class StreetsCity(val file: String) {
    JAKARTA("bus-map.json"),
    NEW_YORK("bus-map-nyc.json"),
}

/** How lines sharing a lane are drawn on their own streets, picked in the map's debug panel. */
enum class StreetsApart {
    /** Side by side, as the bundles: the map as it shows. */
    SEPARATED,

    /** One over another, each in its place. */
    OVERLAPPED,
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
