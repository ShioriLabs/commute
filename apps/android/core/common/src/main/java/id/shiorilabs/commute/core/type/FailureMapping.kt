package id.shiorilabs.commute.core.type

import io.ktor.client.network.sockets.ConnectTimeoutException
import io.ktor.client.network.sockets.SocketTimeoutException
import io.ktor.client.plugins.HttpRequestTimeoutException
import java.io.IOException
import java.net.UnknownHostException

/**
 * Maps a [Throwable] to a typed [Failure].
 *
 * The receiver is classified by type:
 * - [ApiException] → [Failure.Remote], carrying the HTTP status and the server's error message.
 * - [HttpRequestTimeoutException], [ConnectTimeoutException], [SocketTimeoutException] →
 *   [Failure.Network.Timeout].
 * - [UnknownHostException] and any other [IOException] → [Failure.Network.NoConnection].
 * - Any other throwable → [Failure.Unknown].
 *
 * The receiver is preserved as [Failure.cause] in every result.
 */
fun Throwable.toFailure(): Failure = when (this) {
    is ApiException -> Failure.Remote(code = status, message = message, cause = this)
    is HttpRequestTimeoutException,
    is ConnectTimeoutException,
    is SocketTimeoutException,
        -> Failure.Network.Timeout(cause = this)
    is UnknownHostException -> Failure.Network.NoConnection(cause = this)
    is IOException -> Failure.Network.NoConnection(cause = this)
    else -> Failure.Unknown(cause = this)
}
