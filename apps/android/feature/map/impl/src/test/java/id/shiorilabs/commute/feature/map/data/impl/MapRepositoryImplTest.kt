package id.shiorilabs.commute.feature.map.data.impl

import id.shiorilabs.commute.core.config.Environment
import id.shiorilabs.commute.core.query.testing.testQueryClient
import id.shiorilabs.commute.feature.map.data.MapStorage
import id.shiorilabs.commute.feature.map.domain.TileId
import id.shiorilabs.commute.feature.map.domain.TileRequest
import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.client.engine.mock.respondError
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Test
import java.time.Clock
import java.time.Instant
import java.time.ZoneId
import java.time.ZoneOffset

@OptIn(ExperimentalCoroutinesApi::class)
class MapRepositoryImplTest {

    private class MutableClock(var now: Instant) : Clock() {
        override fun instant(): Instant = now
        override fun getZone(): ZoneId = ZoneOffset.UTC
        override fun withZone(zone: ZoneId?): Clock = this
    }

    private class FakeStorage : MapStorage {
        val tiles = mutableMapOf<String, ByteArray>()
        var keptBuild: String? = null

        override fun bundled(name: String): String = when (name) {
            "manifest.json" -> manifest("2026-08c", "bundled")
            "points.json" -> points("2026-08c", "KCI-BUNDLED")
            "map-lines.json" -> """{"version":"2026-08c","lines":[]}"""
            else -> """{"version":"2026-08c","points":[]}"""
        }

        override fun readTile(build: String, name: String): ByteArray? = tiles["$build/$name"]

        override fun writeTile(build: String, name: String, bytes: ByteArray) {
            tiles["$build/$name"] = bytes
        }

        override fun keepOnlyBuild(build: String) {
            keptBuild = build
        }
    }

    /** What the web serves under `/maps/fdtj/`, by file name; a missing name is a 500. */
    private val served = mutableMapOf<String, String>()
    private val requested = mutableListOf<String>()
    private val engine = MockEngine { request ->
        val name = request.url.encodedPath.substringAfterLast('/')
        requested += name
        served[name]?.let { respond(it, HttpStatusCode.OK, headersOf(HttpHeaders.ContentType, "application/json")) }
            ?: if (name.endsWith(".webp")) respond(byteArrayOf(1, 2, 3)) else respondError(HttpStatusCode.InternalServerError)
    }
    private val clock = MutableClock(Instant.parse("2026-11-04T10:00:00Z"))
    private val storage = FakeStorage()

    private fun TestScope.repository() = MapRepositoryImpl(
        client = HttpClient(engine),
        environment = Environment(apiBaseUrl = "https://api.test", appVersion = "test", webBaseUrl = "https://web.test"),
        queries = testQueryClient(backgroundScope, clock = clock),
        storage = storage,
        io = StandardTestDispatcher(testScheduler),
    )

    @Test
    fun `with nothing held and the web unreachable, the bundled map opens`() = runTest {
        val data = repository().mapData().getOrNull()!!
        assertEquals("bundled", data.manifest.build)
        assertEquals("KCI-BUNDLED", data.points.single().id)
        assertEquals("bundled", storage.keptBuild)
    }

    @Test
    fun `the map opens from what is held, and the next opening gets what was deployed`() = runTest {
        served["manifest.json"] = manifest("2026-09", "deployed")
        served["points.json"] = points("2026-09", "KCI-DEPLOYED")
        val repository = repository()

        assertEquals("bundled", repository.mapData().getOrNull()!!.manifest.build)
        advanceUntilIdle()

        val next = repository.mapData().getOrNull()!!
        assertEquals("deployed", next.manifest.build)
        assertEquals("KCI-DEPLOYED", next.points.single().id)
        assertEquals("deployed", storage.keptBuild)
    }

    @Test
    fun `a broken deploy of the tap targets keeps the last good copy`() = runTest {
        served["manifest.json"] = manifest("2026-09", "deployed")
        served["points.json"] = points("2026-09", "KCI-DEPLOYED")
        val repository = repository()
        repository.mapData()
        advanceUntilIdle()

        // Five minutes on, a deploy ships tap targets naming nothing the app can open.
        served["points.json"] = points("2026-09", "not a station")
        clock.now = clock.now.plusSeconds(6 * 60)
        repository.mapData()
        advanceUntilIdle()

        assertEquals("KCI-DEPLOYED", repository.mapData().getOrNull()!!.points.single().id)
    }

    @Test
    fun `a tile is fetched once, with its build, and then read from disk`() = runTest {
        val repository = repository()
        val manifest = repository.mapData().getOrNull()!!.manifest
        val request = TileRequest(TileId(2, 3), tier = 0.5, priority = 0.0)

        assertArrayEquals(byteArrayOf(1, 2, 3), repository.tile(manifest, request).getOrNull())
        assertArrayEquals(byteArrayOf(1, 2, 3), storage.tiles["bundled/tile-2-3@0.5x.webp"])
        repository.tile(manifest, request)
        assertEquals(1, requested.count { it == "tile-2-3@0.5x.webp" })
    }

    @Test
    fun `tiers are named as the tile files are`() {
        assertEquals("0.5", MapRepositoryImpl.tierLabel(0.5))
        assertEquals("1", MapRepositoryImpl.tierLabel(1.0))
        assertEquals("2", MapRepositoryImpl.tierLabel(2.0))
    }

    private companion object {

        fun manifest(version: String, build: String) = """
            {"version":"$version","build":"$build","viewBox":[0,0,9513.57,6726.88],
             "grid":{"rows":8,"cols":8},"tileSize":{"w":1189.19625,"h":840.86},
             "raster":{"format":"webp","tiers":[0.5,1,2]},"preview":{"url":"preview.webp","w":1280,"h":905},
             "source":"ignored"}
        """.trimIndent()

        fun points(version: String, id: String) =
            """{"version":"$version","points":[{"id":"$id","ax":0,"ay":0,"bx":0,"by":0,"r":10}]}"""
    }
}
