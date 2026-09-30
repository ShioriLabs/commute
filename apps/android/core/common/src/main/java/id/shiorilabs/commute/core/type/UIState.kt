package id.shiorilabs.commute.core.type

/**
 * The state of an asynchronous operation that produces a value of type [T].
 *
 * A typical progression is [Idle] → [Loading] → [Success] or [Error]. A subsequent reload after
 * a [Success] can be modeled by re-entering [Success] with [Success.isRefreshing] set, keeping
 * the previously loaded [Success.data] available.
 *
 * @param T The type of data carried by the [Success] state.
 */
sealed interface UIState<out T> {

    /** The operation has not started. */
    data object Idle : UIState<Nothing>

    /**
     * The operation is in progress and no result is available yet.
     *
     * To preserve previously loaded data across a reload, transition to [Success] with
     * [Success.isRefreshing] set instead of returning to [Loading].
     */
    data object Loading : UIState<Nothing>

    /**
     * The operation completed successfully.
     *
     * @property data The value produced by the operation.
     * @property isRefreshing `true` while a subsequent reload is in flight, leaving [data] valid
     *   in the meantime.
     */
    data class Success<T>(
        val data: T,
        val isRefreshing: Boolean = false,
    ) : UIState<T>

    /**
     * The operation failed.
     *
     * @property message A human-readable description of the error, when one is available.
     * @property cause The originating [Throwable], when the failure was derived from one.
     */
    data class Error(
        val message: String? = null,
        val cause: Throwable? = null,
    ) : UIState<Nothing>
}

/**
 * Whether this state has something to paint — [UIState.Success] *or* [UIState.Error].
 *
 * An error state is painted content too (the section renders its empty/retry state), so code that
 * waits for a screen to be "ready" must treat it as an end state; waiting past it would measure the
 * user's retry instead.
 */
fun UIState<*>.isSettled(): Boolean = this is UIState.Success<*> || this is UIState.Error
