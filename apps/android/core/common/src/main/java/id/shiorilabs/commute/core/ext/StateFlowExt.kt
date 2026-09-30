package id.shiorilabs.commute.core.ext

import id.shiorilabs.commute.core.type.UIState
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.update

/**
 * Transitions a [UIState] flow into a loading state, preserving previously loaded data when
 * possible.
 *
 * If the current value is [UIState.Success], the data is kept and only `isRefreshing` is flipped —
 * this lets the UI keep rendering the existing content while a refresh is in flight (e.g. for
 * pull-to-refresh). Otherwise, the flow transitions to [UIState.Loading], which is the cold-start
 * case where there is nothing to show yet.
 *
 * @param isRefreshing whether the new load is a refresh of already-loaded data. Only meaningful
 * when the flow is currently in [UIState.Success]; ignored when transitioning to [UIState.Loading].
 */
fun <S> MutableStateFlow<UIState<S>>.toLoading(isRefreshing: Boolean) {
    update { state ->
        if (state is UIState.Success<S>) {
            state.copy(data = state.data, isRefreshing = isRefreshing)
        } else {
            UIState.Loading
        }
    }
}

/**
 * Acknowledges a [UIState.Error] and returns the flow to [UIState.Idle] so the user can retry,
 * leaving any other state untouched.
 *
 * Call this after surfacing the error to the user (e.g. once a Toast has been shown). A
 * `LaunchedEffect` keyed on [UIState] won't re-fire when two consecutive error values are equal,
 * so resetting to [UIState.Idle] forces the next failure to go through `Idle → Loading → Error`
 * again, guaranteeing the effect runs once per attempt.
 */
fun <S> MutableStateFlow<UIState<S>>.consumeError() {
    update { state -> if (state is UIState.Error) UIState.Idle else state }
}

/**
 * Surfaces a load failure without discarding already-loaded content — the error arm of every
 * fetch-with-refresh fold.
 *
 * On a cold load (current value isn't [UIState.Success]) the flow transitions to [UIState.Error] so
 * the screen can show its error state. When data is already on screen (a refresh failed), the existing
 * [UIState.Success] is kept and only its `isRefreshing` flag is cleared, so the user keeps seeing the
 * stale-but-valid content instead of an error screen.
 *
 * ```
 * result.fold(
 *     ifLeft = { _orders.setErrorOrKeep(it.toUserMessage(), it.cause) },
 *     ifRight = { page -> /* feature-specific success */ },
 * )
 * ```
 */
fun <S> MutableStateFlow<UIState<S>>.setErrorOrKeep(message: String, cause: Throwable? = null) {
    update { state ->
        if (state is UIState.Success<S>) {
            state.copy(isRefreshing = false)
        } else {
            UIState.Error(message, cause)
        }
    }
}
