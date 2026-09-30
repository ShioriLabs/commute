package id.shiorilabs.commute.core.type

/**
 * A typed error.
 *
 * Partitioned into three variants:
 * - [Network] — no response was received.
 * - [Remote] — the server responded with a non-2xx status.
 * - [Unknown] — anything that doesn't fit the above.
 */
sealed interface Failure {

    /**
     * Human-readable description of the error, when one is available.
     */
    val message: String?

    /**
     *  The originating [Throwable], when the failure was derived from one.
     */
    val cause: Throwable?

    /** No response was received — connectivity loss, DNS failure, TLS error, timeout, etc. */
    sealed interface Network : Failure {

        /** Request never reached the server (offline, DNS failure, host unreachable). */
        data class NoConnection(
            override val message: String? = null,
            override val cause: Throwable? = null,
        ) : Network

        /** Request was sent but the server didn't respond within the configured deadline. */
        data class Timeout(
            override val message: String? = null,
            override val cause: Throwable? = null,
        ) : Network
    }

    /**
     * The server responded with a non-2xx status.
     *
     * @property code The HTTP status code returned by the server.
     */
    data class Remote(
        val code: Int,
        override val message: String? = null,
        override val cause: Throwable? = null,
    ) : Failure

    /** Catch-all for non-HTTP errors: deserialization failures, programmer errors, etc. */
    data class Unknown(
        override val message: String? = null,
        override val cause: Throwable? = null,
    ) : Failure
}
