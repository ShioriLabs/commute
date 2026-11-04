package id.shiorilabs.commute.feature.map.domain

import kotlin.math.ceil
import kotlin.math.floor
import kotlin.math.ln
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.roundToLong

/*
 * Which tiles to fetch, upload, draw and let go of, frame by frame: the web renderer's tile
 * residency (`map-renderer.ts`, `map-renderer-webgl.ts`), without the GPU. Pure, so it runs under
 * JUnit; the render thread only does what a [TileFramePlan] says.
 */

/** One tile of the grid. [key] names its texture to the renderer. */
data class TileId(val row: Int, val col: Int) {

    fun key(cols: Int): Int = row * cols + col
}

/** A tile's pixels at [tier], to fetch. Lower [priority] first: nearest the middle of the view. */
data class TileRequest(val tile: TileId, val tier: Double, val priority: Double)

/** A tile the renderer holds pixels for, drawn at its world position. */
data class TileDraw(val tile: TileId, val tier: Double)

/**
 * What one frame needs done, in order: [releases] let go of, [upload] sent up (at most one a frame,
 * so a burst of arrivals doesn't stall the frame it lands in), [starts] fetched, and [draws] drawn,
 * over the preview when [needsPreview].
 */
data class TileFramePlan<T>(
    val tier: Double,
    val draws: List<TileDraw>,
    val needsPreview: Boolean,
    val starts: List<TileRequest>,
    val upload: Pair<TileRequest, T>?,
    val releases: List<TileId>,
) {

    /**
     * Whether pixels that have arrived still wait to go up, so another frame is due even with the
     * camera still. Pixels still on their way ask for their own frame when they land.
     */
    var hasReadyPixels: Boolean = false
        internal set
}

/** The raster tier to draw at: the texel:pixel ratio [scale] × [dpr] asks for, rounded up a power of two. */
fun pickTier(scale: Double, dpr: Double, current: Double, tiers: List<Double>): Double {
    val finest = tiers.max()
    val coarsest = tiers.min()
    val target = scale * dpr
    val wanted = 2.0.pow(ceil(ln(max(target, coarsest)) / ln(2.0))).coerceIn(coarsest, finest)
    // The coarsest tier the build made that's at least as fine as asked for.
    val raw = tiers.sorted().firstOrNull { it >= wanted - 1e-9 } ?: finest
    // Not past a boundary until well past it, so a pinch resting on one doesn't thrash.
    if (raw > current && target <= current * TIER_HYSTERESIS) return current
    return raw
}

private const val TIER_HYSTERESIS = 1.1

/** The render resolution is capped at this many pixels per dp: past it the artwork has no more detail. */
const val MAX_RENDER_DPR = 2.0

/** GPU bytes a [width] × [height] RGB565 tile costs with its mip chain. */
fun textureBytes(width: Long, height: Long): Long = width * height * BYTES_PER_PIXEL * 4 / 3

private const val BYTES_PER_PIXEL = 2L

/**
 * How many tile bytes to keep: what is on screen, and as much again for panning back, up to
 * [ceiling]. Never below what is on screen, since that can't be let go of anyway.
 */
fun tileBudgetBytes(visibleTiles: Int, tileBytes: Long, ceiling: Long): Long {
    val workingSet = max(0, visibleTiles) * max(0L, tileBytes)
    return max(workingSet, min(ceiling, workingSet * BUDGET_HEADROOM))
}

private const val BUDGET_HEADROOM = 2L

/** 128 MB: a phone's tier-2 screen is about 64 MB, so one or two screens of history. */
const val TILE_BUDGET_CEILING_BYTES = 128L * 1024 * 1024

/**
 * The tile residency for one map edition. [T] is a decoded tile's pixels; [discard] frees one the
 * view moved past before it was sent up.
 */
class TilePlanner<T>(
    private val manifest: MapManifest,
    private val ceilingBytes: Long = TILE_BUDGET_CEILING_BYTES,
    private val discard: (T) -> Unit = {},
) {

    private class Entry(
        var tier: Double = 0.0,
        var pendingTier: Double? = null,
        var lastUsed: Long = 0,
        var bytes: Long = 0,
        /** A failed fetch isn't asked again before this, so panning offline doesn't hammer the network. */
        var retryAtMs: Long = 0,
    )

    private val entries = HashMap<TileId, Entry>()
    private val queue = mutableListOf<TileRequest>()
    private val ready = mutableListOf<Pair<TileRequest, T>>()
    private var inFlight = 0
    private var frame = 0L
    private var currentTier = manifest.tiers.min()
    private val tiers = manifest.tiers

    /**
     * Plans a frame of the map at [t] in a [viewWidth] × [viewHeight] pixel view, at [nowMs] on any
     * monotonic clock.
     */
    fun frame(t: Transform, viewWidth: Double, viewHeight: Double, dpr: Double, nowMs: Long): TileFramePlan<T> {
        frame++
        currentTier = pickTier(t.scale, min(dpr, MAX_RENDER_DPR), currentTier, tiers)
        val tileW = manifest.tileSize.w
        val tileH = manifest.tileSize.h

        val minX = -t.tx / t.scale
        val minY = -t.ty / t.scale
        val maxX = (viewWidth - t.tx) / t.scale
        val maxY = (viewHeight - t.ty) / t.scale
        val centerX = (minX + maxX) / 2
        val centerY = (minY + maxY) / 2
        val firstCol = max(0, floor(minX / tileW).toInt())
        val lastCol = min(manifest.grid.cols - 1, floor(maxX / tileW).toInt())
        val firstRow = max(0, floor(minY / tileH).toInt())
        val lastRow = min(manifest.grid.rows - 1, floor(maxY / tileH).toInt())

        // Stamped first: what is stale is what this frame doesn't show.
        val visible = mutableListOf<TileId>()
        for (row in firstRow..lastRow) {
            for (col in firstCol..lastCol) {
                val tile = TileId(row, col)
                entries.getOrPut(tile, ::Entry).lastUsed = frame
                visible += tile
            }
        }
        pruneStale()
        // Before the draws, so what goes up this frame is drawn in it.
        val upload = ready.minByOrNull { it.first.priority }?.also { ready.remove(it) }
        upload?.let { (request, _) -> settle(request) }

        val draws = mutableListOf<TileDraw>()
        var needsPreview = false
        for (tile in visible) {
            val entry = entries.getValue(tile)
            if (entry.tier > 0) draws += TileDraw(tile, entry.tier) else needsPreview = true
            // A coarser tier stays drawn until the finer one arrives.
            if (entry.tier < currentTier && entry.pendingTier == null && nowMs >= entry.retryAtMs) {
                val dx = ((tile.col + 0.5) * tileW - centerX) / tileW
                val dy = ((tile.row + 0.5) * tileH - centerY) / tileH
                entry.pendingTier = currentTier
                queue += TileRequest(tile, currentTier, dx * dx + dy * dy)
            }
        }

        val starts = mutableListOf<TileRequest>()
        queue.sortBy { it.priority }
        while (inFlight < MAX_CONCURRENT_LOADS && queue.isNotEmpty()) {
            starts += queue.removeAt(0)
            inFlight++
        }

        val visibleCount = visible.size
        val releases = mutableListOf<TileId>()
        downgradeOverResolved(releases)
        evict(visibleCount, releases)

        return TileFramePlan(currentTier, draws, needsPreview, starts, upload, releases).also {
            it.hasReadyPixels = ready.isNotEmpty()
        }
    }

    /** [request]'s pixels arrived; they go up on a later frame, if the view still wants them. */
    fun fetched(request: TileRequest, pixels: T) {
        inFlight = max(0, inFlight - 1)
        ready += request to pixels
    }

    /** [request] couldn't be fetched at [nowMs]; a frame [RETRY_AFTER_MS] later asks again. */
    fun failed(request: TileRequest, nowMs: Long) {
        inFlight = max(0, inFlight - 1)
        val entry = entries[request.tile] ?: return
        if (entry.pendingTier == request.tier) entry.pendingTier = null
        entry.retryAtMs = nowMs + RETRY_AFTER_MS
    }

    /**
     * The renderer let go of everything, as when its surface went: every tile is fetched again.
     * Pixels already on their way still land.
     */
    fun forgetResidency() {
        for (entry in entries.values) {
            entry.tier = 0.0
            entry.bytes = 0
        }
    }

    /** Every tile with pixels, to release as the map goes to the background. */
    fun releaseAll(): List<TileId> {
        val held = entries.filterValues { it.tier > 0 }.keys.toList()
        forgetResidency()
        return held
    }

    /** Bytes the renderer holds for tiles now. */
    val residentBytes: Long get() = entries.values.sumOf { it.bytes }

    private fun settle(request: TileRequest) {
        val entry = entries.getOrPut(request.tile, ::Entry)
        entry.tier = request.tier
        entry.bytes = textureBytes(
            (manifest.tileSize.w * request.tier).roundToLong(),
            (manifest.tileSize.h * request.tier).roundToLong(),
        )
        if (entry.pendingTier == request.tier) entry.pendingTier = null
    }

    /**
     * Work the view moved past: a tier no longer wanted, or a tile scrolled off. Left in place, a
     * pending tier would also exempt its tile from eviction for good.
     */
    private fun isStale(request: TileRequest): Boolean {
        val entry = entries[request.tile] ?: return true
        return request.tier != currentTier || entry.lastUsed != frame
    }

    private fun pruneStale() {
        queue.removeAll { request ->
            isStale(request).also { stale -> if (stale) cancel(request) }
        }
        ready.removeAll { (request, pixels) ->
            isStale(request).also { stale ->
                if (stale) {
                    cancel(request)
                    discard(pixels)
                }
            }
        }
    }

    private fun cancel(request: TileRequest) {
        val entry = entries[request.tile] ?: return
        if (entry.pendingTier == request.tier) entry.pendingTier = null
    }

    /**
     * Off-screen tiles held finer than the view now asks for are let go, or zooming into a corner
     * and back out would pin them at the finest tier. On-screen ones stay: swapping them out would
     * flash the preview under the rider.
     */
    private fun downgradeOverResolved(releases: MutableList<TileId>) {
        val iterator = entries.entries.iterator()
        while (iterator.hasNext()) {
            val (tile, entry) = iterator.next()
            if (entry.lastUsed == frame || entry.pendingTier != null) continue
            if (entry.tier == 0.0) {
                iterator.remove()
            } else if (entry.tier > currentTier) {
                releases += tile
                iterator.remove()
            }
        }
    }

    /** Least recently drawn first until the budget fits; never what's on screen or on its way. */
    private fun evict(visibleCount: Int, releases: MutableList<TileId>) {
        val budget = tileBudgetBytes(
            visibleCount,
            textureBytes((manifest.tileSize.w * currentTier).roundToLong(), (manifest.tileSize.h * currentTier).roundToLong()),
            ceilingBytes,
        )
        var bytes = residentBytes
        if (bytes <= budget) return
        val candidates = entries.entries
            .filter { (_, entry) -> entry.lastUsed != frame && entry.pendingTier == null && entry.tier > 0 }
            .sortedBy { it.value.lastUsed }
        for ((tile, entry) in candidates) {
            if (bytes <= budget) break
            releases += tile
            bytes -= entry.bytes
            entries.remove(tile)
        }
    }

    companion object {

        /** Tile fetches running at once. */
        const val MAX_CONCURRENT_LOADS = 2

        /** How long a tile that failed to arrive waits before it is asked for again. */
        const val RETRY_AFTER_MS = 5_000L
    }
}
