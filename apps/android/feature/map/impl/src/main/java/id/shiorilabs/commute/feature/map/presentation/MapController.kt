package id.shiorilabs.commute.feature.map.presentation

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.PixelCopy
import android.view.Surface
import id.shiorilabs.commute.feature.map.data.MapRepository
import id.shiorilabs.commute.feature.map.domain.Fling
import id.shiorilabs.commute.feature.map.domain.Flight
import id.shiorilabs.commute.feature.map.domain.MAX_FRAME_DT_MS
import id.shiorilabs.commute.feature.map.domain.MAX_RENDER_DPR
import id.shiorilabs.commute.feature.map.domain.MapData
import id.shiorilabs.commute.feature.map.domain.MapGestures
import id.shiorilabs.commute.feature.map.domain.MapHit
import id.shiorilabs.commute.feature.map.domain.TilePlanner
import id.shiorilabs.commute.feature.map.domain.TileRequest
import id.shiorilabs.commute.feature.map.domain.Transform
import id.shiorilabs.commute.feature.map.domain.Viewport
import id.shiorilabs.commute.feature.map.domain.hitTest
import id.shiorilabs.commute.feature.map.domain.lerpTransform
import id.shiorilabs.commute.feature.map.domain.settled
import id.shiorilabs.commute.feature.map.render.MapRenderThread
import id.shiorilabs.commute.feature.map.render.RenderFrame
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlin.math.min

/**
 * The map on screen, on the main thread: the camera, the touches that move it, and the frames that
 * draw it. The domain classes decide; this wires them to the surface, the render thread and the
 * tile fetches.
 *
 * @param initialCamera where the camera was when the map last left the screen, if it did.
 * @param onStationTap a tap landed on [MapHit.Station]: its `OPERATOR-CODE`.
 */
class MapController(
    private val data: MapData,
    private val repository: MapRepository,
    private val density: Float,
    initialCamera: Transform?,
    initialSnapshot: Bitmap?,
    private val onStationTap: (String) -> Unit,
) {

    /** Whether the map can draw on this device: false once Vulkan has said it can't. */
    val isSupported: StateFlow<Boolean> get() = supported
    private val supported = MutableStateFlow(true)

    /**
     * The map as it last came to rest, at half resolution: what the window shows in its place while
     * the surface can't follow it, as when the screen morphs into home's rail card and back.
     */
    val snapshot: StateFlow<Bitmap?> get() = snapshots
    private val snapshots = MutableStateFlow(initialSnapshot)

    /** Whether the surface shows the whole view, every tile on it drawn: the stand-in can go. */
    val isShowing: StateFlow<Boolean> get() = showing
    private val showing = MutableStateFlow(false)
    private val main = Handler(Looper.getMainLooper())
    private var surface: Surface? = null
    private var snapshotGeneration = 0

    /** Where the camera is now; kept by the screen for the map's next opening. */
    val camera: Transform? get() = rendered

    private val manifest = data.manifest
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val renderer = MapRenderThread(
        onReady = ::onRendererReady,
        onComplete = { showing.value = true },
        onLost = ::onRendererLost,
    )
    private val planner = TilePlanner<Bitmap>(manifest, discard = Bitmap::recycle)
    private val gestures = MapGestures()
    private val invalidations = Channel<Unit>(Channel.CONFLATED)

    private var viewport: Viewport? = null
    private var target: Transform? = initialCamera
    private var rendered: Transform? = initialCamera
    private var grabbed = false
    private var fling: Fling? = null
    private var flight: Flight? = null
    private var flightStartNanos = 0L
    private var pinchStartScale = 1.0
    private var lastFrameNanos = 0L

    private var rendererReady = false
    private var rgb565 = true
    private var preview: Bitmap? = null
    private var previewLoading = false
    private var previewUploaded = false

    /** The surface is up, [widthPx] × [heightPx]. */
    fun onSurface(surface: Surface, widthPx: Int, heightPx: Int) {
        this.surface = surface
        onResize(widthPx, heightPx)
        renderer.attach(surface)
    }

    /**
     * The view is now [widthPx] × [heightPx]. What was in its middle stays there, so a rotation, or a
     * surface first sized before its layout settled, keeps the map on the same place.
     */
    fun onResize(widthPx: Int, heightPx: Int) {
        val previous = viewport
        val view = Viewport(widthPx / density.toDouble(), heightPx / density.toDouble(), manifest.worldWidth, manifest.worldHeight)
        viewport = view
        fun recentred(t: Transform): Transform =
            if (previous == null) view.clamp(t) else view.centeredOn(t, t.worldX(previous.width / 2), t.worldY(previous.height / 2))
        val start = rendered?.let(::recentred) ?: view.initial(data.initialPoint?.centerX, data.initialPoint?.centerY)
        rendered = start
        target = target?.let(::recentred) ?: start
        renderer.resize()
        invalidate()
    }

    /** The surface is going: the renderer lets go of it, and of every texture, before this returns. */
    fun onSurfaceDestroyed() {
        surface = null
        showing.value = false
        snapshotGeneration++
        renderer.detach()
        rendererReady = false
        previewUploaded = false
        planner.forgetResidency()
    }

    /** The map went to the background a while ago: its tiles' memory goes back to the system. */
    fun releaseTiles() {
        planner.releaseAll().forEach { renderer.release(it.key(manifest.grid.cols)) }
    }

    fun onPointerDown(id: Long, xPx: Float, yPx: Float, timeMs: Long) = handle(gestures.down(id, dp(xPx), dp(yPx), timeMs))

    fun onPointerMove(id: Long, xPx: Float, yPx: Float, timeMs: Long) = handle(gestures.move(id, dp(xPx), dp(yPx), timeMs))

    fun onPointerUp(id: Long, xPx: Float, yPx: Float, timeMs: Long) = handle(gestures.up(id, dp(xPx), dp(yPx), timeMs))

    fun onPointerCancel() = handle(gestures.cancel())

    /** Waits until the map has something to draw. */
    suspend fun awaitInvalidation() {
        invalidations.receive()
    }

    /**
     * Draws the frame at [frameNanos]: the camera's step, and the tiles it shows. Whether another
     * frame is due straight after.
     */
    fun frame(frameNanos: Long): Boolean {
        val view = viewport ?: return false
        val current = rendered ?: return false
        val dtMs = if (lastFrameNanos == 0L) FIRST_FRAME_DT_MS else ((frameNanos - lastFrameNanos) / 1e6).coerceIn(0.0, MAX_FRAME_DT_MS)
        lastFrameNanos = frameNanos

        val activeFlight = flight
        val activeFling = fling
        val next = when {
            activeFlight != null -> {
                val elapsed = (frameNanos - flightStartNanos) / 1e6
                if (activeFlight.isOver(elapsed)) flight = null
                activeFlight.at(elapsed).also { target = it }
            }

            activeFling != null && !grabbed -> {
                val (moved, left) = activeFling.step(current, dtMs, view)
                fling = left.takeUnless { it.isSpent }
                moved.also { target = it }
            }

            grabbed -> target ?: current
            else -> {
                val goal = target ?: current
                lerpTransform(current, goal, dtMs).let { if (settled(it, goal)) goal else it }
            }
        }
        rendered = next

        val moving = flight != null || fling != null || target?.let { !settled(next, it) } == true
        val readyPixels = if (rendererReady) draw(next, view) else false
        val more = moving || readyPixels
        snapshotGeneration++
        if (!more) {
            lastFrameNanos = 0L
            if (rendererReady) scheduleSnapshot()
        }
        return more
    }

    /**
     * Copies what the surface shows once the frame just asked for has had time to reach it; dropped
     * if anything moves first.
     */
    private fun scheduleSnapshot() {
        val generation = snapshotGeneration
        main.postDelayed({
            val target = surface
            val view = viewport
            if (generation != snapshotGeneration || target == null || !target.isValid || view == null) return@postDelayed
            val width = (view.width * density / SNAPSHOT_DOWNSCALE).toInt().coerceAtLeast(1)
            val height = (view.height * density / SNAPSHOT_DOWNSCALE).toInt().coerceAtLeast(1)
            val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
            runCatching {
                PixelCopy.request(target, bitmap, { result ->
                    if (result == PixelCopy.SUCCESS && generation == snapshotGeneration) snapshots.value = bitmap
                }, main)
            }
        }, SNAPSHOT_DELAY_MS)
    }

    fun dispose() {
        scope.cancel()
        renderer.quit()
        preview?.recycle()
        preview = null
    }

    private fun draw(t: Transform, view: Viewport): Boolean {
        val plan = planner.frame(t, view.width, view.height, min(density.toDouble(), MAX_RENDER_DPR), SystemClock.uptimeMillis())
        val cols = manifest.grid.cols
        plan.releases.forEach { renderer.release(it.key(cols)) }
        plan.upload?.let { (request, bitmap) -> renderer.upload(request.tile.key(cols), bitmap) }
        plan.starts.forEach(::fetch)

        val count = plan.draws.size + if (plan.needsPreview && previewUploaded) 1 else 0
        val keys = IntArray(count)
        val rects = FloatArray(count * 4)
        var i = 0
        // Under everything, where any tile is still on its way.
        if (plan.needsPreview && previewUploaded) {
            keys[0] = PREVIEW_KEY
            rects[2] = manifest.worldWidth.toFloat()
            rects[3] = manifest.worldHeight.toFloat()
            i = 1
        }
        val tileW = manifest.tileSize.w
        val tileH = manifest.tileSize.h
        for (draw in plan.draws) {
            keys[i] = draw.tile.key(cols)
            rects[i * 4] = (draw.tile.col * tileW).toFloat()
            rects[i * 4 + 1] = (draw.tile.row * tileH).toFloat()
            rects[i * 4 + 2] = tileW.toFloat()
            rects[i * 4 + 3] = tileH.toFloat()
            i++
        }
        renderer.submit(
            RenderFrame(
                tx = (t.tx * density).toFloat(),
                ty = (t.ty * density).toFloat(),
                scale = (t.scale * density).toFloat(),
                keys = keys,
                rects = rects,
                count = count,
                complete = !plan.needsPreview && plan.draws.isNotEmpty(),
            ),
        )
        return plan.hasReadyPixels
    }

    private fun fetch(request: TileRequest) {
        scope.launch {
            val bitmap = repository.tile(manifest, request).getOrNull()?.let { decode(it) }
            if (bitmap != null) {
                planner.fetched(request, bitmap)
            } else {
                planner.failed(request, SystemClock.uptimeMillis())
                // Its retry only comes from a frame; ask for one once it's due.
                scope.launch {
                    delay(TilePlanner.RETRY_AFTER_MS)
                    invalidate()
                }
            }
            invalidate()
        }
    }

    private suspend fun decode(bytes: ByteArray): Bitmap? = withContext(Dispatchers.Default) {
        val options = BitmapFactory.Options().apply {
            inPreferredConfig = if (rgb565) Bitmap.Config.RGB_565 else Bitmap.Config.ARGB_8888
        }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options)
    }

    private fun onRendererReady(rgb565: Boolean) {
        this.rgb565 = rgb565
        rendererReady = true
        val held = preview
        if (held != null) {
            renderer.upload(PREVIEW_KEY, held, recycle = false)
            previewUploaded = true
        } else if (!previewLoading) {
            previewLoading = true
            scope.launch {
                preview = repository.preview(manifest).getOrNull()?.let { decode(it) }
                previewLoading = false
                val loaded = preview
                if (loaded != null && rendererReady) {
                    renderer.upload(PREVIEW_KEY, loaded, recycle = false)
                    previewUploaded = true
                }
                invalidate()
            }
        }
        invalidate()
    }

    private fun onRendererLost() {
        rendererReady = false
        supported.value = false
    }

    private fun handle(events: List<MapGestures.Event>) {
        val view = viewport ?: return
        for (event in events) {
            val t = target ?: return
            when (event) {
                MapGestures.Event.Grabbed -> {
                    // The finger picks the map up where the eye sees it.
                    fling = null
                    flight = null
                    target = rendered
                    grabbed = true
                }

                MapGestures.Event.Released -> grabbed = false

                is MapGestures.Event.Pan -> target = view.clamp(Transform(t.tx + event.dx, t.ty + event.dy, t.scale))

                MapGestures.Event.PinchStarted -> pinchStartScale = t.scale

                is MapGestures.Event.Pinch ->
                    target = view.zoomAt(t, event.anchorX, event.anchorY, pinchStartScale * event.factor / t.scale)

                is MapGestures.Event.Fling -> fling = Fling(event.vx, event.vy)

                is MapGestures.Event.Tap -> tap(t, event.x, event.y)

                is MapGestures.Event.DoubleTap -> {
                    val zoomed = if (t.scale >= view.maxScale * MAX_SCALE_TOLERANCE) {
                        view.zoomAt(t, event.x, event.y, view.minScale / t.scale)
                    } else {
                        view.zoomAt(t, event.x, event.y, min(view.maxScale, t.scale * 2) / t.scale)
                    }
                    flight = Flight(rendered ?: t, zoomed, Flight.ZOOM_STEP_MS)
                    flightStartNanos = System.nanoTime()
                }
            }
            if (grabbed) rendered = target
        }
        invalidate()
    }

    private fun tap(t: Transform, x: Double, y: Double) {
        val hit = hitTest(t.worldX(x), t.worldY(y), data.points, data.labels, TOUCH_HIT_SLOP_DP / t.scale)
        if (hit is MapHit.Station) {
            // It opened something, so a second tap isn't a zoom.
            gestures.forgetTap()
            onStationTap(hit.point.stationId)
        }
    }

    private fun dp(px: Float): Double = px / density.toDouble()

    private fun invalidate() {
        invalidations.trySend(Unit)
    }

    private companion object {

        /** The preview's texture, apart from every tile's `row * cols + col`. */
        const val PREVIEW_KEY = -1

        /** A finger is broader than a pointer, so taps get this much grace around each target. */
        const val TOUCH_HIT_SLOP_DP = 12.0

        /** At the finest zoom, within rounding: a double tap there zooms back out. */
        const val MAX_SCALE_TOLERANCE = 0.98

        /** The first frame after a still spell has no previous one to measure from. */
        const val FIRST_FRAME_DT_MS = 16.0

        /** Long enough for the frame just asked for to be presented. */
        const val SNAPSHOT_DELAY_MS = 100L

        /** A stand-in for a quarter-second morph needn't be sharp. */
        const val SNAPSHOT_DOWNSCALE = 2.0
    }
}
