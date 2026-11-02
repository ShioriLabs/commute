package id.shiorilabs.commute.core.ui.ext

import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.State
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.snapshotFlow
import androidx.compose.runtime.snapshots.Snapshot
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.withTimeoutOrNull

/**
 * Brings a row that appears at the very top of the list into view, when the list was resting at
 * the top: a banner that shows up once the screen is already on.
 *
 * A lazy list holds its place by the row it was showing, so without this the new first row is
 * laid out above the viewport, out of sight behind whatever floats over the list. A list the
 * rider has scrolled down keeps its place: yanking it back up would be worse than the banner
 * waiting at the top.
 */
@Composable
fun LazyListState.RevealInsertedTop(inserted: Boolean) {
    val previous = remember { booleanArrayOf(inserted) }
    if (inserted && !previous[0]) {
        // Read without subscribing: this composable has no business recomposing on every scroll.
        val atTop = Snapshot.withoutReadObservation { firstVisibleItemIndex == 0 && firstVisibleItemScrollOffset == 0 }
        if (atTop) {
            requestScrollToItem(0)
        }
    }
    SideEffect { previous[0] = inserted }
}

/**
 * Keeps the list at its top while [top] (the first row's key) changes before it has [drawn]: rows
 * that land while a held splash still hides the screen are part of the first frame, so it opens
 * on them rather than on the row that happened to be first when the list was first laid out.
 * Once drawn, a change leaves the list where it is.
 */
@Composable
fun LazyListState.KeepTopUntilDrawn(top: Any?, drawn: () -> Boolean) {
    val previous = remember { arrayOf(top) }
    if (top != previous[0] && !drawn()) {
        requestScrollToItem(0)
    }
    SideEffect { previous[0] = top }
}

/**
 * Whether rows have just landed out of sight above a list that was resting at its top, once it has
 * [drawn]: [top] (the first row's key) changed and the list held its place by the row on screen. For
 * offering a way up without moving what the rider is reading. It lasts until the list is scrolled,
 * by whoever, or for [forMillis]. A new first row that was already on screen never counts, as the
 * list stays at its top.
 */
@Composable
fun LazyListState.landedAboveTop(top: Any?, forMillis: Long, drawn: () -> Boolean): State<Boolean> {
    val previous = remember { arrayOf(top) }
    val landed = remember { mutableStateOf(false) }
    if (top != previous[0] && top != null && drawn()) {
        // Read without subscribing, as in RevealInsertedTop; this pass runs before the list's layout
        // moves it off the top.
        landed.value = landed.value ||
            Snapshot.withoutReadObservation { firstVisibleItemIndex == 0 && firstVisibleItemScrollOffset == 0 }
    }
    SideEffect { previous[0] = top }
    LaunchedEffect(landed.value) {
        if (landed.value) {
            withTimeoutOrNull(forMillis) { snapshotFlow { isScrollInProgress }.first { it } }
            landed.value = false
        }
    }
    return remember { derivedStateOf { landed.value && firstVisibleItemIndex > 0 } }
}
