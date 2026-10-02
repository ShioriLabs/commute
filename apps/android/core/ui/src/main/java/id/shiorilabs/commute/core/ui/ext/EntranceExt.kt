package id.shiorilabs.commute.core.ui.ext

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.Easing
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
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/*
 * The web's staggered entrances (apps/web/app/app.css) with their delays (apps/web/utils/stagger.ts).
 * Two of them, because what reads as a cascade depends on the size of what is moving:
 *
 *   rows   `.search-result-enter` + LIST_STAGGER: dense rows rise 8 dp over 250 ms, 30 ms apart.
 *   cards  `.home-enter` + CARD_STAGGER: tall cards rise 12 dp over 300 ms, 45 ms apart. 8 dp of
 *          travel is invisible on a block that size, and 30 ms between them reads as all at once.
 *   nav    `.home-enter-nav` + NAV_STAGGER: the home rail's cards rise 16 dp over 300 ms, 50 ms
 *          apart, starting 120 ms in so they follow the feed rather than race it.
 */

private class Entrance(
    val millis: Int,
    val step: Int,
    /**
     * Index past which every item shares the same delay. Without a cap the fiftieth row of a long
     * list would sit invisible for a second and a half before appearing at all.
     */
    val maxIndex: Int,
    val travel: Dp,
    val easing: Easing,
    /** Before the first item starts. */
    val offset: Int = 0,
) {
    fun delayMillis(index: Int): Int = offset + index.coerceIn(0, maxIndex) * step
}

private val RowEntrance = Entrance(
    millis = 250,
    step = 30,
    maxIndex = 12,
    travel = 8.dp,
    // CSS's `ease-out` keyword, which is what the web's keyframes run on (not Tailwind's).
    easing = CubicBezierEasing(0f, 0f, 0.58f, 1f),
)

private val CardEntrance = Entrance(
    millis = 300,
    step = 45,
    maxIndex = 6,
    travel = 12.dp,
    // The web's --ease-ios-spring.
    easing = CubicBezierEasing(0.36f, 0.66f, 0.04f, 1f),
)

private val NavEntrance = Entrance(
    millis = 300,
    step = NAV_STAGGER_STEP_MILLIS,
    maxIndex = 4,
    travel = 16.dp,
    easing = CardEntrance.easing,
    offset = NAV_STAGGER_OFFSET_MILLIS,
)

/** The web's NAV_STAGGER_OFFSET_MS: the home rail waits this long for the feed. */
const val NAV_STAGGER_OFFSET_MILLIS = 120

/** The web's NAV_STAGGER_STEP_MS, between one rail card and the next. */
const val NAV_STAGGER_STEP_MILLIS = 50

/** The entrance delay for the row at [index]. */
fun rowStaggerDelayMillis(index: Int): Int = RowEntrance.delayMillis(index)

/** The entrance delay for the card at [index]. */
fun cardStaggerDelayMillis(index: Int): Int = CardEntrance.delayMillis(index)

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
fun Modifier.rowEntrance(index: Int): Modifier = entrance(RowEntrance, index)

/** [rowEntrance] for tall cards: further, slower, and further apart. */
@Composable
fun Modifier.cardEntrance(index: Int): Modifier = entrance(CardEntrance, index)

/**
 * [rowEntrance] for the home rail's cards, after the feed. Apply it to a wrapper around the card,
 * not the card: the card's own modifiers carry its morph, which measures it where it stands.
 */
@Composable
fun Modifier.navEntrance(index: Int): Modifier = entrance(NavEntrance, index)

@Composable
private fun Modifier.entrance(entrance: Entrance, index: Int): Modifier {
    var played by rememberSaveable { mutableStateOf(false) }
    val progress = remember { Animatable(if (played) 1f else 0f) }

    LaunchedEffect(Unit) {
        if (!played) {
            progress.animateTo(
                targetValue = 1f,
                animationSpec = tween(
                    durationMillis = entrance.millis,
                    delayMillis = entrance.delayMillis(index),
                    easing = entrance.easing,
                ),
            )
            played = true
        }
    }

    return this.graphicsLayer {
        alpha = progress.value
        translationY = (1f - progress.value) * entrance.travel.toPx()
    }
}
