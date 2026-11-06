package id.shiorilabs.commute.feature.map.presentation

import androidx.compose.animation.core.animate
import androidx.compose.animation.core.spring
import androidx.compose.foundation.gestures.AnchoredDraggableState
import androidx.compose.foundation.gestures.DraggableAnchors
import androidx.compose.foundation.gestures.Orientation
import androidx.compose.foundation.gestures.draggable
import androidx.compose.foundation.gestures.rememberDraggableState
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.input.nestedscroll.NestedScrollConnection
import androidx.compose.ui.input.nestedscroll.NestedScrollSource
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.Velocity
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlin.math.abs
import kotlin.math.roundToInt

/** Where the map's sheet rests: up to the status bar, at its peek, or away below the screen. */
internal enum class SheetStop { Full, Peek, Hidden }

/**
 * The map's sheet, in pixels from the top of the screen.
 *
 * Material's sheet didn't suit the map. It takes every touch for itself while it moves, its
 * spring then takes nearly half a second to settle at the top, and each touch it takes ends in
 * another spring, so a scroll straight after a flick went nowhere until the sheet was peeked and
 * raised again. It also passed what was left of a list's fling on to itself, so a flick to the
 * top of the list dropped the sheet to its peek. This one leaves a touch to the list unless it
 * drags the sheet, and settles without overshooting, ending within half a pixel.
 */
@Stable
internal class MapSheetState(
    private val scope: CoroutineScope,
    /** As the sheet starts away, so what it showed can go with it. */
    private val onHiding: () -> Unit,
) {
    val anchored = AnchoredDraggableState(SheetStop.Hidden)

    /** The stop it rests at or is settling to: where a drag started from. */
    var stop by mutableStateOf(SheetStop.Hidden)
        private set

    private var settling: Job? = null

    /** Where the sheet's top stands now: at the hidden stop before it moves, NaN before any anchors. */
    val offset: Float
        get() = anchored.offset.takeUnless { it.isNaN() } ?: anchored.anchors.positionOf(SheetStop.Hidden)

    fun updateAnchors(full: Float, peek: Float, hidden: Float) {
        anchored.updateAnchors(
            DraggableAnchors {
                SheetStop.Full at full
                SheetStop.Peek at peek
                SheetStop.Hidden at hidden
            },
            newTarget = stop,
        )
    }

    /** Moves the sheet to [target], carrying on at [velocity] in pixels a second. */
    fun moveTo(target: SheetStop, velocity: Float = 0f) {
        stop = target
        if (target == SheetStop.Hidden) onHiding()
        settling?.cancel()
        settling = scope.launch {
            anchored.anchoredDrag(target) { anchors, latest ->
                val to = anchors.positionOf(latest)
                val from = anchored.offset.takeUnless { it.isNaN() } ?: to
                val top = anchors.minPosition()
                val bottom = anchors.maxPosition()
                animate(from, to, velocity, SettleSpring) { value, speed -> dragTo(value.coerceIn(top, bottom), speed) }
            }
        }
    }

    /** Drags the sheet by [delta], stopping any settle under way: what it took. */
    fun drag(delta: Float): Float {
        if (anchored.offset.isNaN()) return 0f
        stopSettling()
        return anchored.dispatchRawDelta(delta)
    }

    /** Whether the sheet stands at one of its stops rather than somewhere between. */
    val isAtStop: Boolean
        get() {
            val anchors = anchored.anchors
            val at = offset
            return SheetStop.entries.any { anchors.hasPositionFor(it) && abs(anchors.positionOf(it) - at) < AT_STOP_PX }
        }

    /**
     * Lets go of the sheet at [velocity]: a flick goes on to the next stop its way, a slow release
     * to the stop it was dragged past [commitPx] towards, else back to where it started.
     */
    fun settle(velocity: Float, flickPx: Float, commitPx: Float) {
        val anchors = anchored.anchors
        if (anchored.offset.isNaN() || anchors.size == 0) return
        val at = offset
        fun positionOf(stop: SheetStop) = anchors.positionOf(stop)
        val target = when {
            velocity <= -flickPx ->
                SheetStop.entries.filter { positionOf(it) < at - AT_STOP_PX }.maxByOrNull(::positionOf) ?: SheetStop.Full

            velocity >= flickPx ->
                SheetStop.entries.filter { positionOf(it) > at + AT_STOP_PX }.minByOrNull(::positionOf) ?: SheetStop.Hidden

            else -> {
                val from = positionOf(stop)
                if (abs(at - from) < commitPx) {
                    stop
                } else {
                    val down = at > from
                    SheetStop.entries
                        .filter { if (down) positionOf(it) > from else positionOf(it) < from }
                        .minByOrNull { abs(positionOf(it) - at) } ?: stop
                }
            }
        }
        moveTo(target, velocity)
    }

    private fun stopSettling() {
        settling?.cancel()
        settling = null
    }
}

@Composable
internal fun rememberMapSheetState(onHiding: () -> Unit): MapSheetState {
    val scope = rememberCoroutineScope()
    return remember(scope) { MapSheetState(scope, onHiding) }
}

/**
 * [state]'s sheet over the screen, [height] tall: [peek] of it shows at its peek, and at full its
 * top stands [fullTop] from the top of the screen, [screenHeight] tall.
 */
@Composable
internal fun MapSheet(
    state: MapSheetState,
    screenHeight: Dp,
    height: Dp,
    peek: Dp,
    fullTop: Dp,
    shape: Shape,
    color: Color,
    shadowElevation: Dp,
    modifier: Modifier = Modifier,
    content: @Composable () -> Unit,
) {
    val density = LocalDensity.current
    val flickPx = with(density) { FLICK_VELOCITY.toPx() }
    val commitPx = with(density) { COMMIT_DISTANCE.toPx() }
    val hiddenPx = with(density) { screenHeight.toPx() }
    SideEffect {
        with(density) {
            state.updateAnchors(full = fullTop.toPx(), peek = (screenHeight - peek).toPx(), hidden = hiddenPx)
        }
    }
    val connection = remember(state, flickPx, commitPx) { SheetScrollConnection(state, flickPx, commitPx) }
    val dragState = rememberDraggableState { delta -> state.drag(delta) }

    Surface(
        modifier = modifier
            .offset { IntOffset(0, state.offset.takeUnless { it.isNaN() }?.roundToInt() ?: hiddenPx.roundToInt()) }
            .fillMaxWidth()
            .height(height)
            .nestedScroll(connection)
            .draggable(
                state = dragState,
                orientation = Orientation.Vertical,
                onDragStopped = { velocity -> state.settle(velocity, flickPx, commitPx) },
            ),
        shape = shape,
        color = color,
        shadowElevation = shadowElevation,
        content = content,
    )
}

/**
 * Shares a list's drags with the sheet around it: up, the sheet rises to full before the list
 * scrolls; down, the list scrolls back to its top before the sheet drops. A fling settles the
 * sheet only when the gesture moved it. One that just scrolled the list stops at the list's end.
 */
private class SheetScrollConnection(
    private val state: MapSheetState,
    private val flickPx: Float,
    private val commitPx: Float,
) : NestedScrollConnection {

    override fun onPreScroll(available: Offset, source: NestedScrollSource): Offset =
        if (available.y < 0 && source == NestedScrollSource.UserInput) Offset(0f, state.drag(available.y)) else Offset.Zero

    override fun onPostScroll(consumed: Offset, available: Offset, source: NestedScrollSource): Offset =
        if (source == NestedScrollSource.UserInput) Offset(0f, state.drag(available.y)) else Offset.Zero

    override suspend fun onPreFling(available: Velocity): Velocity {
        if (state.isAtStop) return Velocity.Zero
        state.settle(available.y, flickPx, commitPx)
        return available
    }

    override suspend fun onPostFling(consumed: Velocity, available: Velocity): Velocity = available
}

/** The sheet's settle: no overshoot past a stop, and done once within half a pixel of it. */
private val SettleSpring = spring(dampingRatio = 1f, stiffness = 700f, visibilityThreshold = 0.5f)

/** Within this of a stop, in pixels, the sheet is at it. */
private const val AT_STOP_PX = 0.5f

/** A release faster than this, a second, is a flick to the next stop: Material's figure. */
private val FLICK_VELOCITY = 125.dp

/** A slow release this far past where the drag started goes on to the next stop: Material's. */
private val COMMIT_DISTANCE = 56.dp
