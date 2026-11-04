package id.shiorilabs.commute.feature.map.render

import android.graphics.Bitmap
import android.view.Surface

/**
 * The Vulkan renderer in `src/main/cpp`, by handle. Only [MapRenderThread] calls it, always from
 * its own thread: the renderer isn't thread-safe.
 */
internal object MapNative {

    /** Whether the library loaded; without it the map can't draw on this device. */
    val isLoaded: Boolean = runCatching { System.loadLibrary("commutemap") }.isSuccess

    /** A renderer drawing into [surface], or 0 when Vulkan can't on this device. */
    @JvmStatic
    external fun create(surface: Surface): Long

    @JvmStatic
    external fun destroy(handle: Long)

    /** The surface changed size; the next frame rebuilds the swapchain for it. */
    @JvmStatic
    external fun resize(handle: Long)

    /** Whether textures can be [Bitmap.Config.RGB_565]; otherwise they're ARGB_8888. */
    @JvmStatic
    external fun supportsRgb565(handle: Long): Boolean

    @JvmStatic
    external fun deviceName(handle: Long): String

    /** Sends [bitmap] up as texture [key], replacing what [key] held. */
    @JvmStatic
    external fun upload(handle: Long, key: Int, bitmap: Bitmap): Boolean

    @JvmStatic
    external fun release(handle: Long, key: Int)

    /**
     * Draws textures [keys] in order over white, each over its world rect in [rects] (x, y, w, h
     * from `4 * i`), with the world at `world * scale + (tx, ty)` in surface pixels. False once the
     * device is lost.
     */
    @JvmStatic
    external fun draw(handle: Long, tx: Float, ty: Float, scale: Float, keys: IntArray, rects: FloatArray, count: Int): Boolean
}
