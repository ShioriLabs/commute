package id.shiorilabs.commute.core.ui.frost

import androidx.compose.animation.core.EaseInOut
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.runtime.Composable
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import dev.chrisbanes.haze.HazeInput
import dev.chrisbanes.haze.HazeState
import dev.chrisbanes.haze.blur.HazeBlurStyle
import dev.chrisbanes.haze.blur.HazeColorEffect
import dev.chrisbanes.haze.blur.hazeBlur

/*
 * The frost behind a pinned header, after midori's (its `FrostedTopChromeBackdrop`): one platform
 * blur over the header and a short band below it, faded out across that band, so what scrolls
 * under the header dissolves into it instead of meeting a hard line.
 */

/** How long the frost takes to fade in once something scrolls under the header, or out again. */
private const val FROST_FADE_MS = 220

/**
 * Colour stops sampled along the feather's easing. A mask gradient runs straight between stops, so
 * this many keep the curve's flat landing at each end; too few and a seam shows where it bends.
 */
private const val FEATHER_MASK_STOPS = 12

/**
 * How far below a header its frost runs before it has faded out, midori's default. Long enough to
 * read as a gradient rather than an edge; much longer and the fade lays a blurred, tinted veil over
 * the sharp rows coming up beneath, which reads muddy.
 */
val FrostFeatherHeight: Dp = 40.dp

/** An alpha mask: opaque above [fromPx], clear below [toPx], eased between them. */
fun frostFeatherMask(fromPx: Float, toPx: Float): Brush {
    val stops = Array(FEATHER_MASK_STOPS + 1) { i ->
        val t = i / FEATHER_MASK_STOPS.toFloat()
        t to Color.Black.copy(alpha = 1f - EaseInOut.transform(t))
    }
    return Brush.verticalGradient(*stops, startY = fromPx, endY = toPx)
}

/**
 * The frost for a pinned header, drawn as a sibling *behind* it so it can run [featherHeight]
 * past the header's bottom edge and dissolve there. Haze only draws inside its node's bounds,
 * which is why a blur on the header itself ends in a line.
 *
 * Place it over the scrolling [dev.chrisbanes.haze.hazeSource] and under the header, which draws
 * no surface of its own. [chromeHeight] is the header's height, status bar included. The blur's
 * look, and where and how long the fade runs, come from [LocalFrostTuning].
 *
 * At rest nothing sits under the header, and a blur would only tint the page a shade off, so the
 * header shows [restingColor] until [scrolled]; then the frost fades in over it. It also waits for
 * the page's enter transition to settle, with nothing steady to sample before then. Nothing here
 * takes a touch, so taps in the feather band reach the list beneath.
 */
@Composable
fun FrostedTopChromeBackdrop(
    hazeState: HazeState,
    chromeHeight: Dp,
    surfaceColor: Color,
    modifier: Modifier = Modifier,
    scrolled: Boolean = true,
    restingColor: Color = surfaceColor,
    featherHeight: Dp = FrostFeatherHeight,
) {
    val tuning = LocalFrostTuning.current
    val settled = rememberNavTransitionSettled()
    val canBlur = rememberFrostBlurEnabled() || tuning.forceBlur
    val frostAlpha = animateFloatAsState(
        targetValue = if (settled && scrolled) 1f else 0f,
        animationSpec = tween(FROST_FADE_MS),
        label = "frostAlpha",
    )
    val frostVisible by remember { derivedStateOf { frostAlpha.value > 0f } }
    val density = LocalDensity.current
    val chromeHeightPx = with(density) { chromeHeight.toPx() }
    val feather = (featherHeight * tuning.featherScale).coerceAtLeast(1.dp)
    val fadeStart = (chromeHeight - tuning.featherShift).coerceAtLeast(0.dp)
    val fadeStartPx = with(density) { fadeStart.toPx() }
    val featherPx = with(density) { feather.toPx() }
    val featherMask = remember(fadeStartPx, featherPx) {
        frostFeatherMask(fadeStartPx, fadeStartPx + featherPx)
    }

    Box(
        modifier = modifier
            .fillMaxWidth()
            .height(maxOf(chromeHeight, fadeStart + feather))
            // Under the header only: the band below is the page's own while the frost is out.
            .drawBehind {
                drawRect(
                    color = restingColor.copy(alpha = restingColor.alpha * (1f - frostAlpha.value)),
                    size = Size(size.width, chromeHeightPx),
                )
            },
    ) {
        // Detached while fully faded: at alpha 0 the blur would still sample the page and upload a
        // layer on every frame of a scroll, for nothing on screen.
        if (!frostVisible) {
            return@Box
        }
        Box(
            modifier = Modifier
                .matchParentSize()
                .graphicsLayer { alpha = frostAlpha.value }
                .hazeBlur(
                    input = HazeInput.Sources(hazeState),
                    style = HazeBlurStyle {
                        backgroundColor(if (tuning.backgroundFill) surfaceColor else Color.Transparent)
                        colorEffects(listOf(HazeColorEffect.tint(surfaceColor.copy(alpha = tuning.tintAlpha))))
                        blurRadius(tuning.blurRadius)
                        noiseFactor(tuning.noiseFactor)
                        blurEnabled(canBlur)
                        mask(featherMask)
                    },
                    performanceMode = tuning.performanceMode,
                ),
        )
    }
}
