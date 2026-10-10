package id.shiorilabs.commute.core.network.service

import id.shiorilabs.commute.core.config.Environment
import id.shiorilabs.commute.core.network.HttpClientFactory
import id.shiorilabs.commute.core.network.service.impl.CommuteServiceImpl
import id.shiorilabs.commute.core.type.ApiException
import id.shiorilabs.commute.core.type.Fetched
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.MockRequestHandleScope
import io.ktor.client.engine.mock.respond
import io.ktor.client.request.HttpRequestData
import io.ktor.client.request.HttpResponseData
import io.ktor.http.content.OutgoingContent
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpMethod
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class CommuteServiceImplTest {

    private val requests = mutableListOf<HttpRequestData>()

    private fun service(handler: MockRequestHandleScope.(HttpRequestData) -> HttpResponseData) =
        CommuteServiceImpl(
            HttpClientFactory.create(
                json = Json { ignoreUnknownKeys = true },
                engine = MockEngine { request ->
                    requests += request
                    handler(request)
                },
                environment = Environment(apiBaseUrl = "https://api.test/", appVersion = "test"),
            ),
        )

    @Test
    fun `a 200 is the envelope's data with the response's ETag`() = runTest {
        val service = service {
            respond(
                content = """{"status":200,"data":[]}""",
                headers = headersOf(
                    HttpHeaders.ContentType to listOf("application/json"),
                    HttpHeaders.ETag to listOf("W/\"abc\""),
                ),
            )
        }

        val answer = service.getTransfers("KCI", "MRI")

        assertEquals(Fetched.Body(emptyList<Nothing>(), "W/\"abc\""), answer)
        assertNull(requests.single().headers[HttpHeaders.IfNoneMatch])
    }

    @Test
    fun `a validator goes out as If-None-Match, and a 304 is NotModified`() = runTest {
        val service = service {
            respond(content = "", status = HttpStatusCode.NotModified, headers = headersOf(HttpHeaders.ETag, "W/\"abc\""))
        }

        val answer = service.getTransfers("KCI", "MRI", ifNoneMatch = "W/\"abc\"")

        assertEquals(Fetched.NotModified("W/\"abc\""), answer)
        assertEquals("W/\"abc\"", requests.single().headers[HttpHeaders.IfNoneMatch])
    }

    @Test
    fun `a hub and a line are read from their public paths`() = runTest {
        val service = service { request ->
            val data = when (request.url.encodedPath) {
                "/hubs/dukuh-atas" ->
                    """{"id":"HUB-DKA","slug":"dukuh-atas","name":"Dukuh Atas","kind":"hub","heroImage":null,""" +
                        """"lines":["KCI:C"],"members":[]}"""
                "/lines/KCI/B" ->
                    """{"operator":{"code":"KCI","name":"Commuter Line"},""" +
                        """"line":{"name":"Lin Bogor","colorCode":"#EE3D43","lineCode":"B"},"segments":[]}"""
                else -> error("unexpected ${request.url}")
            }
            respond(
                content = """{"status":200,"data":$data}""",
                headers = headersOf(HttpHeaders.ContentType, "application/json"),
            )
        }

        val hub = service.getHub("dukuh-atas") as Fetched.Body
        val line = service.getLine("KCI", "B") as Fetched.Body

        assertEquals("Dukuh Atas", hub.data.name)
        assertEquals("Lin Bogor", line.data.line.name)
    }

    @Test
    fun `a non-2xx still throws ApiException`() = runTest {
        val service = service { respond(content = "", status = HttpStatusCode.NotFound) }

        val thrown = runCatching { service.getTransfers("KCI", "MRI", ifNoneMatch = "W/\"abc\"") }.exceptionOrNull()

        assertTrue(thrown is ApiException)
        assertEquals(404, (thrown as ApiException).status)
    }

    @Test
    fun `a trip log goes up once, as zstd, with the app's version`() = runTest {
        val service = service { respond(content = "", status = HttpStatusCode.ServiceUnavailable) }
        val body = byteArrayOf(0x28, 0xb5.toByte(), 0x2f, 0xfd.toByte(), 1, 2, 3)

        val thrown = runCatching { service.uploadTripLog(body, appVersion = "1.2.3") }.exceptionOrNull()

        assertEquals(503, (thrown as ApiException).status)
        // Not retried: a second try would be stored as a second upload.
        val request = requests.single()
        assertEquals(HttpMethod.Post, request.method)
        assertEquals("/uploads/trips", request.url.encodedPath)
        assertEquals("1.2.3", request.headers["X-App-Version"])
        assertEquals(ContentType("application", "zstd"), request.body.contentType)
        assertTrue(body.contentEquals((request.body as OutgoingContent.ByteArrayContent).bytes()))
    }
}
