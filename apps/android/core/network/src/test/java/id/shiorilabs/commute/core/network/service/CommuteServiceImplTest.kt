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
import io.ktor.http.HttpHeaders
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
    fun `a non-2xx still throws ApiException`() = runTest {
        val service = service { respond(content = "", status = HttpStatusCode.NotFound) }

        val thrown = runCatching { service.getTransfers("KCI", "MRI", ifNoneMatch = "W/\"abc\"") }.exceptionOrNull()

        assertTrue(thrown is ApiException)
        assertEquals(404, (thrown as ApiException).status)
    }
}
