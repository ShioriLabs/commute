package id.shiorilabs.commute.feature.map.data.impl

import arrow.core.Either
import id.shiorilabs.commute.core.config.Environment
import id.shiorilabs.commute.core.query.QueryClient
import id.shiorilabs.commute.core.query.QueryPolicy
import id.shiorilabs.commute.core.query.QuerySpec
import id.shiorilabs.commute.core.query.queryKey
import id.shiorilabs.commute.core.type.ApiException
import id.shiorilabs.commute.core.type.Failure
import id.shiorilabs.commute.core.type.Fetched
import id.shiorilabs.commute.core.type.toFailure
import id.shiorilabs.commute.feature.map.data.MapRepository
import id.shiorilabs.commute.feature.map.data.MapStorage
import id.shiorilabs.commute.feature.map.domain.MapCorridors
import id.shiorilabs.commute.feature.map.domain.MapData
import id.shiorilabs.commute.feature.map.domain.MapLines
import id.shiorilabs.commute.feature.map.domain.MapManifest
import id.shiorilabs.commute.feature.map.domain.MapPoints
import id.shiorilabs.commute.feature.map.domain.TileRequest
import id.shiorilabs.commute.feature.map.domain.isUsableFor
import id.shiorilabs.commute.feature.map.domain.resolveMapData
import io.ktor.client.HttpClient
import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.statement.HttpResponse
import io.ktor.client.statement.bodyAsBytes
import io.ktor.client.statement.bodyAsText
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.isSuccess
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.withContext
import kotlinx.serialization.KSerializer
import kotlinx.serialization.json.Json
import java.time.Duration
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Serves the map from the web host ([Environment.webBaseUrl]). The manifest and the tap targets go
 * through the [QueryClient] under `map/…`, revalidated after [FRESH_FOR] as the web's `_headers` let
 * them be; tiles go to [MapStorage]'s disk cache, one directory per tile build.
 */
@Singleton
class MapRepositoryImpl internal constructor(
    private val client: HttpClient,
    private val environment: Environment,
    private val queries: QueryClient,
    private val storage: MapStorage,
    private val io: CoroutineDispatcher,
) : MapRepository {

    @Inject
    constructor(client: HttpClient, environment: Environment, queries: QueryClient, storage: MapStorage) :
        this(client, environment, queries, storage, Dispatchers.IO)

    private val json = Json { ignoreUnknownKeys = true }

    private val manifestQuery = jsonQuery(MANIFEST, MapManifest.serializer())

    // A copy that wouldn't parse, or names no station the app can open, fails the fetch, so the
    // client keeps the copy it held before.
    private val pointsQuery = jsonQuery(POINTS, MapPoints.serializer()) { it.requireUsable() }
    private val labelsQuery = jsonQuery(LABELS, MapPoints.serializer()) { it.requireUsable() }
    private val linesQuery = jsonQuery(LINES, MapLines.serializer()) { check(it.lines.isNotEmpty()) { "No lines traced" } }
    private val corridorsQuery = jsonQuery(CORRIDORS, MapCorridors.serializer()) { check(it.corridors.isNotEmpty()) { "No corridors" } }

    override suspend fun mapData(): Either<Failure, MapData> = Either.catch {
        // The first answer of each is what is held, read from disk, never a network wait; the
        // revalidation they start runs on in the app's scope for the next opening.
        val manifest = queries.observe(manifestQuery).first().data
        val points = queries.observe(pointsQuery).first().data
        val labels = queries.observe(labelsQuery).first().data
        val lines = queries.observe(linesQuery).first().data
        val corridors = queries.observe(corridorsQuery).first().data
        val data = withContext(io) {
            resolveMapData(
                deployedManifest = manifest,
                deployedPoints = points,
                deployedLabels = labels,
                bundledManifest = json.decodeFromString(MapManifest.serializer(), storage.bundled(MANIFEST)),
                bundledPoints = json.decodeFromString(MapPoints.serializer(), storage.bundled(POINTS)),
                bundledLabels = json.decodeFromString(MapPoints.serializer(), storage.bundled(LABELS)),
                deployedLines = lines,
                bundledLines = json.decodeFromString(MapLines.serializer(), storage.bundled(LINES)),
                deployedCorridors = corridors,
                bundledCorridors = json.decodeFromString(MapCorridors.serializer(), storage.bundled(CORRIDORS)),
            )
        }
        withContext(io) { storage.keepOnlyBuild(data.manifest.build) }
        data
    }.mapLeft(Throwable::toFailure)

    override suspend fun tile(manifest: MapManifest, request: TileRequest): Either<Failure, ByteArray> =
        cached(manifest, "tile-${request.tile.row}-${request.tile.col}@${tierLabel(request.tier)}x.webp")

    override suspend fun preview(manifest: MapManifest): Either<Failure, ByteArray> =
        cached(manifest, manifest.preview?.url ?: PREVIEW)

    private suspend fun cached(manifest: MapManifest, name: String): Either<Failure, ByteArray> = Either.catch {
        withContext(io) { storage.readTile(manifest.build, name) }
            ?: client.get(url("$name?v=${manifest.build}")).requireSuccess().bodyAsBytes().also { bytes ->
                withContext(io) { storage.writeTile(manifest.build, name, bytes) }
            }
    }.mapLeft(Throwable::toFailure)

    private fun <T> jsonQuery(name: String, serializer: KSerializer<T>, validate: (T) -> Unit = {}): QuerySpec<T> =
        QuerySpec(queryKey(MAP, name), serializer, QueryPolicy.freshFor(FRESH_FOR)) { etag ->
            val response = client.get(url(name)) {
                if (etag != null) header(HttpHeaders.IfNoneMatch, etag)
            }
            if (response.status == HttpStatusCode.NotModified) {
                Fetched.NotModified(response.headers[HttpHeaders.ETag])
            } else {
                val body = json.decodeFromString(serializer, response.requireSuccess().bodyAsText())
                validate(body)
                Fetched.Body(body, response.headers[HttpHeaders.ETag])
            }
        }

    private fun url(path: String): String = "${environment.webBaseUrl.trimEnd('/')}/maps/fdtj/$path"

    private fun HttpResponse.requireSuccess(): HttpResponse = also {
        if (!status.isSuccess()) throw ApiException(status = status.value)
    }

    private fun MapPoints.requireUsable() {
        check(isUsableFor(version)) { "Tap targets for $version that the app can't use" }
    }

    internal companion object {

        const val MAP = "map"
        const val MANIFEST = "manifest.json"
        const val POINTS = "points.json"
        const val LABELS = "label-points.json"
        const val LINES = "map-lines.json"
        const val CORRIDORS = "map-corridors.json"
        const val PREVIEW = "preview.webp"

        /** As long as the web's `_headers` let a browser hold them. */
        val FRESH_FOR: Duration = Duration.ofMinutes(5)

        /** A tier as the tile files name it: `0.5`, `1`, `2`. */
        fun tierLabel(tier: Double): String =
            if (tier == Math.floor(tier)) tier.toLong().toString() else tier.toString()
    }
}
