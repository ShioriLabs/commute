package id.shiorilabs.commute.core.type

/**
 * What a conditional request answered: a fresh [Body], or [NotModified] when the copy the caller
 * already holds (named by its ETag in `If-None-Match`) is still the current one.
 *
 * [etag] is the validator to send next time; on a 304 the server repeats it.
 */
sealed interface Fetched<out T> {

    val etag: String?

    data class Body<T>(val data: T, override val etag: String? = null) : Fetched<T>

    data class NotModified(override val etag: String? = null) : Fetched<Nothing>
}

/**
 * The body of an unconditional request. Only for callers that sent no `If-None-Match`, so a 304
 * can't be the answer; it throws if one is.
 */
fun <T> Fetched<T>.requireBody(): T = when (this) {
    is Fetched.Body -> data
    is Fetched.NotModified -> error("304 Not Modified for a request that sent no validator")
}
