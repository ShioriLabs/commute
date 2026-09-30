package id.shiorilabs.commute.core.ext

import id.shiorilabs.commute.core.type.UIState
import kotlinx.coroutines.flow.MutableStateFlow
import org.junit.Assert.assertEquals
import org.junit.Test

class StateFlowExtTest {

    @Test
    fun `toLoading from a cold state transitions to Loading`() {
        val state = MutableStateFlow<UIState<String>>(UIState.Idle)

        state.toLoading(isRefreshing = true)

        assertEquals(UIState.Loading, state.value)
    }

    @Test
    fun `toLoading from Success keeps data and only flips isRefreshing`() {
        val state = MutableStateFlow<UIState<String>>(UIState.Success("stations", isRefreshing = false))

        state.toLoading(isRefreshing = true)

        assertEquals(UIState.Success("stations", isRefreshing = true), state.value)
    }

    @Test
    fun `consumeError resets an Error to Idle`() {
        val state = MutableStateFlow<UIState<String>>(UIState.Error("oops"))

        state.consumeError()

        assertEquals(UIState.Idle, state.value)
    }

    @Test
    fun `consumeError leaves a non-Error state untouched`() {
        val success = UIState.Success("stations")
        val state = MutableStateFlow<UIState<String>>(success)

        state.consumeError()

        assertEquals(success, state.value)
    }

    @Test
    fun `setErrorOrKeep surfaces an Error on a cold state`() {
        val state = MutableStateFlow<UIState<String>>(UIState.Idle)

        state.setErrorOrKeep("network down")

        assertEquals(UIState.Error("network down"), state.value)
    }

    @Test
    fun `setErrorOrKeep keeps loaded data and clears isRefreshing when a refresh fails`() {
        val state = MutableStateFlow<UIState<String>>(UIState.Success("stations", isRefreshing = true))

        state.setErrorOrKeep("refresh failed")

        assertEquals(UIState.Success("stations", isRefreshing = false), state.value)
    }
}
