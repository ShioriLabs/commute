package id.shiorilabs.commute.core.network.ext

import id.shiorilabs.commute.core.network.response.Response
import id.shiorilabs.commute.core.type.ApiException
import id.shiorilabs.commute.core.type.Fetched
import io.ktor.client.call.body
import io.ktor.client.statement.HttpResponse
import io.ktor.client.statement.bodyAsText
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.isSuccess
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/**
 * Throws [ApiException] on a non-2xx status; otherwise decodes the body to [T].
 *
 * The non-2xx [ApiException] carries the server's error message (best-effort); a decode failure on
 * a 2xx body is rethrown as an [ApiException] with the original [Throwable] as its `cause`.
 */
internal suspend inline fun <reified T> HttpResponse.decodeOrThrow(): T {
    if (!status.isSuccess()) {
        throw ApiException(status = status.value, message = errorMessage())
    }
    return try {
        body()
    } catch (t: Throwable) {
        throw ApiException(status = status.value, cause = t)
    }
}

/**
 * [decodeOrThrow] for a request that may have sent `If-None-Match`: a 304 is
 * [Fetched.NotModified], and a 2xx is the envelope's `data` with the response's ETag.
 */
internal suspend inline fun <reified T> HttpResponse.decodeFetched(): Fetched<T> {
    val etag = headers[HttpHeaders.ETag]
    if (status == HttpStatusCode.NotModified) {
        return Fetched.NotModified(etag)
    }
    return Fetched.Body(decodeOrThrow<Response<T>>().data, etag)
}

/**
 * Reads `error.message` out of the API's error envelope
 * (`{ "status": 404, "error": { "code": "NOT_FOUND", "message": "Not found" } }`), or `null` when
 * the body isn't one — a proxy's HTML error page, say.
 */
private suspend fun HttpResponse.errorMessage(): String? = runCatching {
    Json.parseToJsonElement(bodyAsText())
        .jsonObject.getValue("error")
        .jsonObject.getValue("message")
        .jsonPrimitive.content
}.getOrNull()
