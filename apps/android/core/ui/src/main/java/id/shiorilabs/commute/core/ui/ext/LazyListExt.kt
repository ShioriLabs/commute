package id.shiorilabs.commute.core.ui.ext

import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.remember
import androidx.compose.runtime.snapshots.Snapshot

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
