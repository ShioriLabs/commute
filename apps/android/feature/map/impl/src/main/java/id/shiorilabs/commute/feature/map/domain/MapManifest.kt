package id.shiorilabs.commute.feature.map.domain

import kotlinx.serialization.Serializable

/**
 * The web's `/maps/fdtj/manifest.json`: which edition of the FDTJ map is up, and how its artwork is
 * cut into tiles. Everything the renderer sizes by comes from here, so a re-tiled or re-sized
 * edition ships with a web deploy alone.
 *
 * World space is the source PDF's [viewBox] units; a tile is [tileSize] of them, its rasters
 * `round(tileSize * tier)` pixels.
 */
@Serializable
data class MapManifest(
    /** The edition, e.g. `2026-08c`; the tap targets carry the same one. */
    val version: String,
    /** A content hash of the tiles, sent as `?v=` and naming their cache. */
    val build: String,
    /** `[minX, minY, width, height]`. */
    val viewBox: List<Double>,
    val grid: Grid,
    val tileSize: TileSize,
    val raster: Raster,
    val preview: Preview? = null,
) {

    val worldWidth: Double get() = viewBox[2]
    val worldHeight: Double get() = viewBox[3]

    /** The raster tiers the build made, finest last, e.g. `[0.5, 1, 2]`. */
    val tiers: List<Double> get() = raster.tiers.sorted()

    @Serializable
    data class Grid(val rows: Int, val cols: Int)

    @Serializable
    data class TileSize(val w: Double, val h: Double)

    @Serializable
    data class Raster(val format: String, val tiers: List<Double>)

    /** One low-resolution image of the whole map, drawn under tiles that haven't arrived. */
    @Serializable
    data class Preview(val url: String, val w: Int, val h: Int)
}

/** Whether [this] is one the renderer can draw: a world, a grid and at least one raster tier. */
fun MapManifest.isDrawable(): Boolean =
    viewBox.size == 4 && worldWidth > 0 && worldHeight > 0 &&
        grid.rows > 0 && grid.cols > 0 && tileSize.w > 0 && tileSize.h > 0 &&
        raster.tiers.isNotEmpty() && raster.tiers.all { it > 0 }
