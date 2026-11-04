package id.shiorilabs.commute.feature.map.render

import android.graphics.Bitmap
import android.os.Handler
import android.os.HandlerThread
import android.os.Looper
import android.util.Log
import android.view.Surface
import java.util.concurrent.ConcurrentLinkedQueue
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference

/** One frame to draw: textures [keys] over their world [rects], under the camera, in surface pixels. */
class RenderFrame(
    val tx: Float,
    val ty: Float,
    val scale: Float,
    val keys: IntArray,
    val rects: FloatArray,
    val count: Int,
)

/**
 * The thread the Vulkan renderer lives on. The main thread hands it work and never waits on it, so
 * a frame's acquire and present can block here instead of on the UI: textures go up and come down
 * in the order asked, and only the latest frame asked for is drawn.
 *
 * [onReady] and [onLost] are called on the main thread.
 */
class MapRenderThread(
    private val onReady: (rgb565: Boolean) -> Unit,
    private val onLost: () -> Unit,
) {

    private sealed interface Command {
        class Upload(val key: Int, val bitmap: Bitmap, val recycle: Boolean) : Command
        class Release(val key: Int) : Command
    }

    private val thread = HandlerThread("map-render").apply { start() }
    private val handler = Handler(thread.looper)
    private val main = Handler(Looper.getMainLooper())
    private val commands = ConcurrentLinkedQueue<Command>()
    private val latest = AtomicReference<RenderFrame?>()
    private val drawPosted = AtomicBoolean(false)

    // The render thread's own.
    private var handle = 0L

    /** Starts drawing into [surface]: [onReady] says whether it can, [onLost] if it can't after all. */
    fun attach(surface: Surface) {
        handler.post {
            handle = if (MapNative.isLoaded) MapNative.create(surface) else 0L
            if (handle == 0L) {
                main.post(onLost)
            } else {
                Log.i(TAG, "Drawing on ${MapNative.deviceName(handle)}")
                val rgb565 = MapNative.supportsRgb565(handle)
                main.post { onReady(rgb565) }
            }
        }
    }

    fun resize() {
        handler.post { if (handle != 0L) MapNative.resize(handle) }
        requestDraw()
    }

    /**
     * Stops drawing and lets go of every texture, before returning: the surface is released as
     * soon as this does, and the renderer must be done with it by then. Work not yet done is
     * dropped; textures come back with the next [attach] only if they're uploaded again.
     */
    fun detach() {
        val done = CountDownLatch(1)
        handler.post {
            drainCommands(upload = false)
            if (handle != 0L) {
                MapNative.destroy(handle)
                handle = 0L
            }
            done.countDown()
        }
        if (!done.await(DETACH_TIMEOUT_MS, TimeUnit.MILLISECONDS)) {
            Log.w(TAG, "The renderer took over ${DETACH_TIMEOUT_MS}ms to let go of its surface")
        }
    }

    /** Sends [bitmap] up as texture [key]; it is recycled after unless [recycle] is false. */
    fun upload(key: Int, bitmap: Bitmap, recycle: Boolean = true) {
        commands += Command.Upload(key, bitmap, recycle)
    }

    fun release(key: Int) {
        commands += Command.Release(key)
    }

    /** Draws [frame] next, after the uploads and releases asked for before it. */
    fun submit(frame: RenderFrame) {
        latest.set(frame)
        requestDraw()
    }

    fun quit() {
        handler.post { drainCommands(upload = false) }
        thread.quitSafely()
    }

    private fun requestDraw() {
        if (drawPosted.compareAndSet(false, true)) {
            handler.post(::drawLatest)
        }
    }

    private fun drawLatest() {
        drawPosted.set(false)
        drainCommands(upload = handle != 0L)
        val frame = latest.get() ?: return
        if (handle == 0L) return
        if (!MapNative.draw(handle, frame.tx, frame.ty, frame.scale, frame.keys, frame.rects, frame.count)) {
            Log.e(TAG, "The GPU stopped drawing the map")
            MapNative.destroy(handle)
            handle = 0L
            main.post(onLost)
        }
    }

    private fun drainCommands(upload: Boolean) {
        while (true) {
            when (val command = commands.poll() ?: return) {
                is Command.Upload -> {
                    if (upload && !MapNative.upload(handle, command.key, command.bitmap)) {
                        Log.w(TAG, "Texture ${command.key} didn't go up")
                    }
                    if (command.recycle) command.bitmap.recycle()
                }

                is Command.Release -> if (handle != 0L) MapNative.release(handle, command.key)
            }
        }
    }

    private companion object {

        const val TAG = "MapRenderThread"

        /** Past this the surface goes anyway; a hung GPU mustn't hang the UI with it. */
        const val DETACH_TIMEOUT_MS = 2_000L
    }
}
