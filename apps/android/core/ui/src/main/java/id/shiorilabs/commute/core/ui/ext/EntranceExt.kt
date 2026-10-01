package id.shiorilabs.commute.core.ui.ext

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.tween
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.unit.dp

/*
 * The web's `.search-result-enter` (apps/web/app/app.css) with its LIST_STAGGER delays
 * (apps/web/utils/stagger.ts): dense rows rise 8 dp into place over 250 ms, 30 ms apart.
 */

private const val ROW_ENTRANCE_MILLIS = 250
private const val ROW_STAGGER_MILLIS = 30

/**
 * Index past which every row shares the same delay. Without a cap the fiftieth row of a long list
 * would sit invisible for a second and a half before appearing at all.
 */
private const val ROW_STAGGER_MAX_INDEX = 12

/** How far a row travels up into place. */
private val ROW_ENTRANCE_TRAVEL = 8.dp

/** CSS's `ease-out` keyword, which is what the web's keyframes run on (not Tailwind's). */
private val RowEntranceEasing = CubicBezierEasing(0f, 0f, 0.58f, 1f)

/** The entrance delay for the row at [index]. */
fun rowStaggerDelayMillis(index: Int): Int =
    index.coerceIn(0, ROW_STAGGER_MAX_INDEX) * ROW_STAGGER_MILLIS

/**
 * Fades and lifts a list row into place the first time it composes, after a delay that grows with
 * [index], so a list that changes under the rider cascades in rather than snapping.
 *
 * Apply it to rows in a keyed lazy list. A row whose key survives an update keeps its state and
 * does not replay, so only the rows that are actually new animate, which is what the web gets from
 * React keeping the same element. The "played" flag is saveable for the same reason: a row scrolled
 * off and back, or a screen restored, is already in place.
 *
 * The delay rides on the tween, so it scales with the system animation speed and disappears with
 * animations turned off.
 */
@Composable
fun Modifier.rowEntrance(index: Int): Modifier {
    var played by rememberSaveable { mutableStateOf(false) }
    val progress = remember { Animatable(if (played) 1f else 0f) }

    LaunchedEffect(Unit) {
        if (!played) {
            progress.animateTo(
                targetValue = 1f,
                animationSpec = tween(
                    durationMillis = ROW_ENTRANCE_MILLIS,
                    delayMillis = rowStaggerDelayMillis(index),
                    easing = RowEntranceEasing,
                ),
            )
            played = true
        }
    }

    return this.graphicsLayer {
        alpha = progress.value
        translationY = (1f - progress.value) * ROW_ENTRANCE_TRAVEL.toPx()
    }
}
