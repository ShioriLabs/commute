package id.shiorilabs.commute.feature.map.data

import arrow.core.Either
import id.shiorilabs.commute.core.type.Failure
import id.shiorilabs.commute.feature.map.domain.MapData
import id.shiorilabs.commute.feature.map.domain.MapManifest
import id.shiorilabs.commute.feature.map.domain.TileRequest

/**
 * The FDTJ map's data, served by the web (`/maps/fdtj/`), so a re-tiled map or moved tap targets
 * reach the app with a web deploy. Offline first: what was fetched before, else what the app was
 * built with.
 */
interface MapRepository {

    /**
     * The map to open now, from what is already held, without waiting on the network: the deployed
     * copies fetched before, else the bundled ones. Revalidates in the background, so the next
     * opening has the latest. Fails only when the bundled copies can't be read.
     */
    suspend fun mapData(): Either<Failure, MapData>

    /** [request]'s encoded pixels (WebP): from the disk cache, else fetched and kept there. */
    suspend fun tile(manifest: MapManifest, request: TileRequest): Either<Failure, ByteArray>

    /** The low-resolution whole-map image drawn under tiles not yet arrived; cached the same way. */
    suspend fun preview(manifest: MapManifest): Either<Failure, ByteArray>
}
