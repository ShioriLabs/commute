package id.shiorilabs.commute.core.ui.frost

import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import dev.chrisbanes.haze.HazePerformanceMode

/**
 * The knobs of the frost behind pinned headers ([FrostedTopChromeBackdrop]), held as state so a
 * debug build can tune them live on a phone (the frost tuner, `FrostTunerOverlay`). Every default
 * is the shipped value and release builds never change them, so outside the tuner this is just the
 * frost's constants in one place. After midori's.
 *
 * Read through [LocalFrostTuning]. The values are snapshot state, so a frost reading one recomposes
 * when it moves.
 */
@Stable
class FrostTuning {

    /** The blur's radius. */
    var blurRadius: Dp by mutableStateOf(DEFAULT_BLUR_RADIUS)

    /** How much of the page colour is washed over the blur. */
    var tintAlpha: Float by mutableFloatStateOf(DEFAULT_TINT_ALPHA)

    /** Grain over the blur, `0f..1f`. */
    var noiseFactor: Float by mutableFloatStateOf(DEFAULT_NOISE)

    /** Whether the page colour is painted under what the blur captures. */
    var backgroundFill: Boolean by mutableStateOf(DEFAULT_BACKGROUND_FILL)

    /** Let Haze pick the input scale itself instead of [quality]. */
    var adaptiveQuality: Boolean by mutableStateOf(DEFAULT_ADAPTIVE)

    /** Fixed input quality, `0f` (Haze's lowest) to `1f` (full resolution), when not adaptive. */
    var quality: Float by mutableFloatStateOf(DEFAULT_QUALITY)

    /** Moves where the fade below a header starts: positive starts it higher, inside the header. */
    var featherShift: Dp by mutableStateOf(0.dp)

    /** Scales how far below a header the fade runs. */
    var featherScale: Float by mutableFloatStateOf(1f)

    /**
     * Blur even where [rememberFrostBlurEnabled] says the phone can't afford it, so the real frost
     * can be judged on any device, the emulator included. Debug only; never on by default.
     */
    var forceBlur: Boolean by mutableStateOf(false)

    val performanceMode: HazePerformanceMode
        get() = if (adaptiveQuality) HazePerformanceMode.Adaptive else HazePerformanceMode.Fixed(quality)

    /** Puts every knob back on its shipped value. */
    fun reset() {
        blurRadius = DEFAULT_BLUR_RADIUS
        tintAlpha = DEFAULT_TINT_ALPHA
        noiseFactor = DEFAULT_NOISE
        backgroundFill = DEFAULT_BACKGROUND_FILL
        adaptiveQuality = DEFAULT_ADAPTIVE
        quality = DEFAULT_QUALITY
        featherShift = 0.dp
        featherScale = 1f
        forceBlur = false
    }

    /** The current values on one line, for pasting back into the defaults. */
    fun describe(): String =
        "blurRadius=${blurRadius.value}dp tintAlpha=${tintAlpha.fmt()} noise=${noiseFactor.fmt()} " +
            "backgroundFill=$backgroundFill quality=${if (adaptiveQuality) "Adaptive" else quality.fmt()} " +
            "featherShift=${featherShift.value}dp featherScale=${featherScale.fmt()}"

    private fun Float.fmt(): String = "%.2f".format(this)

    companion object {

        /** One blur for every frosted header, so they read as one material. */
        val DEFAULT_BLUR_RADIUS: Dp = 24.dp

        /**
         * Wide headers that carry text want most of a solid surface and only a hint of what passes
         * beneath; any less and the detail scrolling under churns through.
         */
        const val DEFAULT_TINT_ALPHA = 0.70f

        /** What makes the blur read as frost rather than smoke. Haze's default is 0.15. */
        const val DEFAULT_NOISE = 0.20f

        const val DEFAULT_BACKGROUND_FILL = true

        /**
         * Full resolution: the layer is wide and the radius large, and Haze's adaptive input halves
         * it, which shows. The platform blur downsamples inside anyway.
         */
        const val DEFAULT_ADAPTIVE = false
        const val DEFAULT_QUALITY = 1f
    }
}

/**
 * The frost's tuning. Defaults to an instance holding the shipped values; the app root provides one
 * of its own, which only the debug frost tuner ever edits.
 */
val LocalFrostTuning = staticCompositionLocalOf { FrostTuning() }
