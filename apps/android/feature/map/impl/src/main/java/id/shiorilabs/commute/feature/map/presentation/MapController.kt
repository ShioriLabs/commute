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
import id.shiorilabs.commute.feature.map.domain.LineIsolate
import id.shiorilabs.commute.feature.map.domain.MAX_FRAME_DT_MS
import id.shiorilabs.commute.feature.map.domain.MAX_RENDER_DPR
import id.shiorilabs.commute.feature.map.domain.MapData
import id.shiorilabs.commute.feature.map.domain.MapGestures
import id.shiorilabs.commute.feature.map.domain.MapHit
import id.shiorilabs.commute.feature.map.domain.MapLine
import id.shiorilabs.commute.feature.map.domain.MapSelection
import id.shiorilabs.commute.feature.map.domain.MapPoint
import id.shiorilabs.commute.feature.map.domain.Rgb
import id.shiorilabs.commute.feature.map.domain.markerOf
import id.shiorilabs.commute.feature.map.domain.Spotlight
import id.shiorilabs.commute.feature.map.domain.TilePlanner
import id.shiorilabs.commute.feature.map.domain.lineCutShapes
import id.shiorilabs.commute.feature.map.domain.lineOf
import id.shiorilabs.commute.feature.map.domain.linesNear
import id.shiorilabs.commute.feature.map.domain.mapTreatment
import id.shiorilabs.commute.feature.map.domain.markerLabel
import id.shiorilabs.commute.feature.map.domain.seedFadeFrom
import id.shiorilabs.commute.feature.map.render.Pill
import id.shiorilabs.commute.feature.map.render.packOverlay
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
 * @param hubFor the hub a `HUB-…` tap target names, with its ring colour; null while unknown.
 * @param ringColorOf a station's line colour for the ring, once it can be looked up.
 *
 * Held by the map's view model, so it outlives the screen while the map stays on the back stack:
 * a station's page over it and back finds the camera, the open sheet and the textures as they were.
 */
class MapController(
    private val data: MapData,
    private val repository: MapRepository,
    private val density: Float,
    initialCamera: Transform?,
    initialSnapshot: Bitmap?,
    private val hubFor: (hubId: String) -> Pair<String, Rgb?>?,
    private val ringColorOf: suspend (stationId: String) -> Rgb?,
) {

    /** A tap opened something: the screen showing the map plays its haptic. */
    var onHit: () -> Unit = {}

    /** Whether the map can draw on this device: false once Vulkan has said it can't. */
    val isSupported: StateFlow<Boolean> get() = supported
    private val supported = MutableStateFlow(true)

    /** What the sheet shows: null with it closed. */
    val selection: StateFlow<MapSelection?> get() = selected
    private val selected = MutableStateFlow<MapSelection?>(null)

    /** The lines under a tap on a stroke several of them share, to pick from; empty otherwise. */
    val lineChoices: StateFlow<List<MapLine>> get() = choices
    private val choices = MutableStateFlow<List<MapLine>>(emptyList())

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
        onTexturesLost = ::onTexturesLost,
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

    private var spotlight: Spotlight? = null
    private var isolate: LineIsolate? = null

    /** Debug: every tap target drawn in pink over the map. */
    var showHitboxes: Boolean = false
        set(value) {
            if (field == value) return
            field = value
            invalidate()
        }

    private val hitboxes: List<Pill> by lazy {
        (data.points + data.labels).map { HITBOX_COLOR.pill(it) }
    }

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
        val height = heightPx / density.toDouble()
        val view = Viewport(
            width = widthPx / density.toDouble(),
            height = height,
            worldWidth = manifest.worldWidth,
            worldHeight = manifest.worldHeight,
            insetBottom = if (selected.value != null) height * Viewport.PEEK_FRACTION else 0.0,
        )
        viewport = view
        fun recentred(t: Transform): Transform =
            if (previous == null) view.clamp(t) else view.centeredOn(t, t.worldX(previous.width / 2), t.worldY(previous.height / 2))
        val start = rendered?.let(::recentred) ?: view.initial(data.initialPoint?.centerX, data.initialPoint?.centerY)
        rendered = start
        target = target?.let(::recentred) ?: start
        renderer.resize()
        invalidate()
    }

    /**
     * The surface is going, as when a station's page covers the map: the renderer lets go of it
     * before this returns, keeping its textures, so the map draws whole the moment it's back.
     */
    fun onSurfaceDestroyed() {
        surface = null
        showing.value = false
        snapshotGeneration++
        renderer.detach()
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

        val moving = flight != null || fling != null || target?.let { !settled(next, it) } == true ||
            spotlight?.isAnimating == true || isolate?.isAnimating == true
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

    /**
     * Opens station [stationId]'s sheet over the map, as a transfer or a hub's member tapped in a
     * sheet does: its marker spotlit and flown to. False when the map doesn't draw it, for the
     * caller to open its page instead.
     */
    fun selectStation(stationId: String): Boolean {
        val marker = data.points.markerOf(stationId) ?: return false
        select(MapSelection.Station(stationId, marker), null)
        return true
    }

    /** Closes the sheet: the spotlight or the isolate fades out and the camera settles back into range. */
    fun clearSelection() {
        choices.value = emptyList()
        if (selected.value == null) return
        selected.value = null
        val now = SystemClock.uptimeMillis()
        spotlight?.exit(now)
        isolate?.exit(now)
        setSheetInset(0.0)
        invalidate()
    }

    /**
     * Isolates line [key], `OPERATOR:CODE`, its sheet taking the place of what was open: opened from
     * station [fromStationId]'s sheet, its way back leads there. False when the map has no traced
     * geometry for it, for the caller to open its page instead.
     */
    fun isolateLine(key: String, fromStationId: String? = null): Boolean {
        val line = data.lines.lineOf(key) ?: return false
        val current = isolate
        if (current == null || current.key != key || current.isLeaving) {
            val shapes = lineCutShapes(line, data.points, data.labels)
            if (shapes.isEmpty()) return false
            val now = SystemClock.uptimeMillis()
            isolate = LineIsolate.after(current, key, shapes, now, alsoDrawn = spotlight?.lastFade)
            // The line is the answer now: a halo left on one stop would read as a second selection.
            spotlight?.exit(now)
        }
        choices.value = emptyList()
        selected.value = MapSelection.Line(line, fromStationId)
        viewport?.let { setSheetInset(it.height * Viewport.PEEK_FRACTION) }
        invalidate()
        return true
    }

    /** One of [lineChoices] picked. */
    fun chooseLine(key: String) {
        if (isolateLine(key)) onHit()
    }

    fun dismissLineChoices() {
        choices.value = emptyList()
    }

    /** Back from a line's sheet to the station's it was opened from, else closed. */
    fun backFromLine() {
        val from = (selected.value as? MapSelection.Line)?.fromStationId
        if (from == null || !selectStation(from)) clearSelection()
    }

    /**
     * Shows [selection]: its point spotlit, the rest of the map faded, its name lit with it and a
     * ring in [color] (neutral until the station's line colour arrives), flown to the middle of
     * what the sheet leaves showing. Takes over from what's lit already, an isolated line
     * included, without the map brightening in between.
     */
    private fun select(selection: MapSelection.Spotlit, color: Rgb?) {
        val point = selection.point
        val now = SystemClock.uptimeMillis()
        choices.value = emptyList()
        selected.value = selection
        spotlight = Spotlight(
            point = point,
            label = markerLabel(point, data.labels),
            color = color ?: Rgb.Neutral,
            startMs = now,
            fadeFrom = seedFadeFrom(spotlight?.lastFade, isolate?.lastFade),
        )
        isolate?.exit(now)
        if (selection is MapSelection.Station && color == null) {
            scope.launch {
                val tint = ringColorOf(selection.stationId) ?: return@launch
                val current = spotlight ?: return@launch
                if (current.point.stationId == selection.stationId) {
                    current.color = tint
                    invalidate()
                }
            }
        }
        val view = viewport
        if (view != null) {
            setSheetInset(view.height * Viewport.PEEK_FRACTION, settle = false)
            val from = rendered ?: return
            fly(from, viewport!!.focus(from, point.centerX, point.centerY), Flight.TO_POINT_MS)
        }
        invalidate()
    }

    /**
     * The sheet now covers [inset] dp of the view's foot. With [settle], a camera out of the new
     * range glides back into it, as the web re-settles when a sheet goes.
     */
    private fun setSheetInset(inset: Double, settle: Boolean = true) {
        val view = viewport?.copy(insetBottom = inset) ?: return
        viewport = view
        val current = rendered ?: return
        val clamped = view.clamp(current)
        if (settle && clamped != current) fly(current, clamped, Flight.SETTLE_MS) else target = target?.let(view::clamp)
    }

    private fun fly(from: Transform, to: Transform, durationMs: Double) {
        fling = null
        flight = Flight(from, to, durationMs)
        flightStartNanos = System.nanoTime()
        invalidate()
    }

    private fun overlay(nowMs: Long): FloatArray {
        val selection = spotlight?.frame(nowMs)
        if (spotlight?.isGone == true) spotlight = null
        val line = isolate?.frame(nowMs)
        if (isolate?.isGone == true) isolate = null
        return packOverlay(mapTreatment(selection, line), if (showHitboxes) hitboxes else emptyList())
    }

    private fun draw(t: Transform, view: Viewport): Boolean {
        val nowMs = SystemClock.uptimeMillis()
        val plan = planner.frame(t, view.width, view.height, min(density.toDouble(), MAX_RENDER_DPR), nowMs)
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
                overlay = overlay(nowMs),
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
        if (previewUploaded) {
            // Carried over from the last surface with the tiles.
        } else if (held != null) {
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

    /** The renderer was made afresh for a new surface: every texture goes up again. */
    private fun onTexturesLost() {
        planner.forgetResidency()
        previewUploaded = false
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

    /**
     * A tap: a station's marker or name opens its sheet, a hub's region the hub's, a line's stroke
     * isolates it, and empty map closes whatever is open, as on the web. A stroke several lines
     * share asks which, as the geometry can't tell.
     */
    private fun tap(t: Transform, x: Double, y: Double) {
        choices.value = emptyList()
        val worldX = t.worldX(x)
        val worldY = t.worldY(y)
        val slop = TOUCH_HIT_SLOP_DP / t.scale
        val opened = when (val hit = hitTest(worldX, worldY, data.points, data.labels, slop)) {
            is MapHit.Station -> {
                select(MapSelection.Station(hit.point.stationId, hit.point), null)
                true
            }

            // A hub not yet known (its list still loading) opens nothing rather than the wrong page.
            is MapHit.Hub -> hubFor(hit.point.id)?.let { (slug, color) ->
                select(MapSelection.Hub(slug, hit.point), color)
                true
            } ?: false

            // The lines run under every point, so a stroke only counts once every point has missed.
            null -> {
                val near = linesNear(data.lines, worldX, worldY, slop)
                when {
                    near.size == 1 && isolateLine(near.single()) -> true
                    near.size > 1 -> {
                        choices.value = near.mapNotNull(data.lines::lineOf)
                        true
                    }

                    else -> {
                        clearSelection()
                        false
                    }
                }
            }
        }
        if (opened) {
            // It opened something, so a second tap isn't a zoom.
            gestures.forgetTap()
            onHit()
        }
    }

    private fun dp(px: Float): Double = px / density.toDouble()

    private fun invalidate() {
        invalidations.trySend(Unit)
    }

    private companion object {

        /** The preview's texture, apart from every tile's `row * cols + col`. */
        const val PREVIEW_KEY = -1

        /** The web's debug pink for tap targets, see-through. */
        val HITBOX_COLOR = Pill(0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.6, 0.3)

        /** [point]'s shape in this pill's colour. */
        fun Pill.pill(point: MapPoint): Pill =
            copy(ax = point.ax, ay = point.ay, bx = point.bx, by = point.by, r = point.r, cr = point.cornerRadius)

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
