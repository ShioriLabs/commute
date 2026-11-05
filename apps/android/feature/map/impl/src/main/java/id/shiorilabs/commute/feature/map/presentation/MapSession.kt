package id.shiorilabs.commute.feature.map.presentation

import android.graphics.Bitmap
import id.shiorilabs.commute.feature.map.domain.Transform
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
}
