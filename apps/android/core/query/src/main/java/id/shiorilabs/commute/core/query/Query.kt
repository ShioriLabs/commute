package id.shiorilabs.commute.core.query

import arrow.core.Either
import id.shiorilabs.commute.core.type.Failure
import id.shiorilabs.commute.core.type.UIState
import id.shiorilabs.commute.core.type.toUserMessage
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import java.time.Instant

/**
 * One query's state as an observer sees it: the newest answer held ([data], confirmed at
 * [updatedAt]), whether a fetch is running, and why the last one failed.
 *
 * A failed fetch keeps the answer it couldn't replace, so [data] and [failure] can both be set: the
 * screen keeps showing it, labelled with its age. That pair is exactly [isOutdated].
 *
 * @property failure Why the last fetch failed, or [Failure.Network.NoConnection] when one was due
 *   but the device was offline. Cleared by the next success.
 */
data class Query<out T>(
    val data: T? = null,
    val updatedAt: Instant? = null,
    val isFetching: Boolean = false,
    val failure: Failure? = null,
) {

    /** Showing an answer that couldn't be refreshed when it was due: say how old it is. */
    val isOutdated: Boolean get() = data != null && failure != null

    fun <R> map(transform: (T) -> R): Query<R> =
        Query(data?.let(transform), updatedAt, isFetching, failure)
}

/**
 * A [Query] over a one-shot [fetch], for a source without a cache of its own (a test's fake, say):
 * [held] alone when there is one, else a fetch in flight and then its answer.
 */
fun <T> queryOnce(held: T?, fetch: suspend () -> Either<Failure, T>): Flow<Query<T>> = flow {
    if (held != null) {
        emit(Query(held))
        return@flow
    }
    emit(Query(isFetching = true))
    emit(fetch().fold(ifLeft = { Query(failure = it) }, ifRight = { Query(it) }))
}

/**
 * The [UIState] a screen paints: any answer held is a [UIState.Success] (refreshing while a fetch
 * runs), even an outdated one; without one, a failure is an [UIState.Error] and otherwise it is
 * still [UIState.Loading].
 */
fun <T> Query<T>.toUIState(): UIState<T> = when {
    data != null -> UIState.Success(data, isRefreshing = isFetching)
    failure != null -> UIState.Error(failure.toUserMessage(), failure.cause)
    else -> UIState.Loading
}
