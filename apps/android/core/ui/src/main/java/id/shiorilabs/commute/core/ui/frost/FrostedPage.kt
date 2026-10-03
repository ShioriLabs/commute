package id.shiorilabs.commute.core.ui.frost

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.SubcomposeLayout
import androidx.compose.ui.unit.Dp
import dev.chrisbanes.haze.HazeState
import dev.chrisbanes.haze.rememberHazeState

/**
 * A page whose [header] floats over its scrolling [content], with the frost behind the header, laid
 * out the way the station page lays out its own.
 *
 * Measured together, header first, so [content] is handed its top padding (the header's height) in
 * the very same frame rather than starting under the header for one. [content] draws the list: it
 * must mark itself as the frost's source (`Modifier.hazeSource(hazeState)`) and scroll with
 * `listState`, whose offset is what fades the frost in.
 *
 * The header draws no surface of its own; [surfaceColor] fills it at rest and tints the frost.
 */
@Composable
fun FrostedHeaderPage(
    surfaceColor: Color,
    header: @Composable () -> Unit,
    modifier: Modifier = Modifier,
    listState: LazyListState = rememberLazyListState(),
    content: @Composable (headerHeight: Dp, listState: LazyListState, hazeState: HazeState) -> Unit,
) {
    val hazeState = rememberHazeState()
    // Off its rest position, the page has something under the header for the frost to blur.
    val scrolled by remember(listState) {
        derivedStateOf { listState.firstVisibleItemIndex > 0 || listState.firstVisibleItemScrollOffset > 0 }
    }

    SubcomposeLayout(
        modifier = modifier
            .fillMaxSize()
            .background(surfaceColor),
    ) { constraints ->
        val loose = constraints.copy(minWidth = 0, minHeight = 0)
        val headers = subcompose(FrostedPageSlot.HEADER, header).map { it.measure(loose) }
        val headerHeight = (headers.maxOfOrNull { it.height } ?: 0).toDp()

        val backdrop = subcompose(FrostedPageSlot.BACKDROP) {
            FrostedTopChromeBackdrop(
                hazeState = hazeState,
                chromeHeight = headerHeight,
                surfaceColor = surfaceColor,
                scrolled = scrolled,
            )
        }.map { it.measure(loose) }

        val list = subcompose(FrostedPageSlot.CONTENT) {
            content(headerHeight, listState, hazeState)
        }.map { it.measure(constraints) }

        layout(constraints.maxWidth, constraints.maxHeight) {
            list.forEach { it.placeRelative(0, 0) }
            backdrop.forEach { it.placeRelative(0, 0) }
            headers.forEach { it.placeRelative(0, 0) }
        }
    }
}

private enum class FrostedPageSlot { HEADER, BACKDROP, CONTENT }
