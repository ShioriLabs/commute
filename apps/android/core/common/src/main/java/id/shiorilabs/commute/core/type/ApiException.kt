package id.shiorilabs.commute.core.type

/**
 * Signals that an HTTP request returned a non-2xx response, or a 2xx one whose body didn't decode.
 *
 * @property status The HTTP status code returned by the server.
 * @param message The `error.message` from the API's error envelope, when one could be read.
 * @param cause The originating throwable, when this exception wraps a secondary failure such as
 *   deserialization of an unexpected response body. `null` for a plain non-2xx response.
 */
open class ApiException(
    val status: Int,
    message: String? = null,
    cause: Throwable? = null,
) : RuntimeException(message, cause)
