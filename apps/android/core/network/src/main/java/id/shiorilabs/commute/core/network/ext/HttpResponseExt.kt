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
        throw apiException()
    }
    return try {
        body()
    } catch (t: Throwable) {
        throw ApiException(status = status.value, cause = t)
    }
}

/** Throws [ApiException] on a non-2xx status, for a request whose answer has nothing to read. */
internal suspend fun HttpResponse.throwUnlessSuccess() {
    if (!status.isSuccess()) {
        throw apiException()
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
 * The [ApiException] for a non-2xx response, carrying what the API's error envelope
 * (`{ "status": 404, "error": { "code": "NOT_FOUND", "message": "Not found" } }`) says: its
 * message, code and, on `CLOSED`, `nextServiceAt`. Each is `null` when the body isn't an envelope
 * — a proxy's HTML error page, say.
 */
internal suspend fun HttpResponse.apiException(): ApiException {
    val error = runCatching { Json.parseToJsonElement(bodyAsText()).jsonObject.getValue("error").jsonObject }.getOrNull()
    fun field(name: String) = runCatching { error?.get(name)?.jsonPrimitive?.content }.getOrNull()
    return ApiException(
        status = status.value,
        message = field("message"),
        code = field("code"),
        nextServiceAt = field("nextServiceAt"),
    )
}
