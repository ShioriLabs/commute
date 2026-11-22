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
