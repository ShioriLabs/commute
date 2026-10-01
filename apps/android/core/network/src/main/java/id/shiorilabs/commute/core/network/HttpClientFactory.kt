package id.shiorilabs.commute.core.network

import id.shiorilabs.commute.core.config.Environment
import io.ktor.client.HttpClient
import io.ktor.client.engine.HttpClientEngine
import io.ktor.client.plugins.HttpRequestRetry
import io.ktor.client.plugins.HttpTimeout
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.client.plugins.defaultRequest
import io.ktor.client.request.header
import io.ktor.http.HttpHeaders
import io.ktor.serialization.kotlinx.json.json
import kotlinx.serialization.json.Json
import java.io.IOException

/** Factory for the Ktor [HttpClient] that talks to the Commute API. */
object HttpClientFactory {

    /** How long a request may take end to end before it fails as a timeout. */
    private const val REQUEST_TIMEOUT_MS = 15_000L

    /**
     * Builds a Ktor [HttpClient] bound to [Environment.apiBaseUrl]:
     *
     * - `defaultRequest` fixes the base URL so callers use relative paths, and names the app in
     *   `User-Agent` so the API's request log can tell its traffic from the web app's.
     * - [ContentNegotiation] handles JSON decode through the supplied [json] instance.
     * - [HttpTimeout] bounds every request; riders open this underground, where a request that
     *   never fails is worse than one that fails fast.
     * - [HttpRequestRetry] retries up to 3 times with exponential backoff on [IOException] so a
     *   cold-start network race self-heals instead of surfacing as an error.
     *
     * No auth plugin: the API is public and read-only, and the app holds no credentials.
     */
    fun create(
        json: Json,
        engine: HttpClientEngine,
        environment: Environment,
    ): HttpClient = HttpClient(engine) {
        defaultRequest {
            url(environment.apiBaseUrl.trimEnd('/') + "/")
            header(HttpHeaders.UserAgent, "Commute-Android/${environment.appVersion}")
        }

        install(ContentNegotiation) {
            json(json)
        }

        install(HttpTimeout) {
            requestTimeoutMillis = REQUEST_TIMEOUT_MS
        }

        install(HttpRequestRetry) {
            retryOnExceptionIf(maxRetries = 3) { _, cause -> cause is IOException }
            exponentialDelay()
        }
    }
}
