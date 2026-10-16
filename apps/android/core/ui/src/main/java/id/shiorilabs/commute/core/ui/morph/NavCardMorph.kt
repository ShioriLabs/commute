package id.shiorilabs.commute.core.ui.morph

import androidx.compose.material3.MaterialTheme
import androidx.compose.animation.AnimatedVisibilityScope
import androidx.compose.animation.BoundsTransform
import androidx.compose.animation.ContentTransform
import androidx.compose.animation.EnterExitState
import androidx.compose.animation.EnterTransition
import androidx.compose.animation.ExitTransition
import androidx.compose.animation.SharedTransitionScope
import androidx.compose.animation.SharedTransitionScope.ResizeMode.Companion.scaleToBounds
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.Easing
import androidx.compose.animation.core.FastOutSlowInEasing
import id.shiorilabs.commute.core.ui.motion.IosSpringEasing
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.RoundRect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.LayoutCoordinates
import androidx.compose.ui.layout.findRootCoordinates
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import androidx.navigation3.ui.NavDisplay
import id.shiorilabs.commute.core.navigation.LocalNavigator
import id.shiorilabs.commute.core.navigation.Route
import kotlin.math.pow

/*
 * The home rail card → full-screen morph, the Compose spelling of the web's SheetButton
 * (apps/web/app/components/nav-buttons/sheet-button.tsx). Opening reads as the card expanding to
 * fill the screen and closing as the screen collapsing back into it.
 *
 * Both ends mark themselves with the same shared-bounds key, the destination [Route]: the card with
 * [navCardMorphSource], the destination screen's root with [NavCardMorphTarget]. Navigation 3 then
 * runs the bounds animation between them, and predictive back scrubs it in reverse.
 *
 * The layers and timings below are the web's:
 *
 *   mask     WHITE, over the scaled content. Opening it is opaque for the first 50 ms and clears
 *            over 100 ms; closing it is front-loaded, opaque within ~60 ms, so the text never shows
 *            distorting.
 *   tint     the card's colour, for an accent card only, above the mask. Its opacity follows the
 *            panel's size: how close it is to card size, to the 4th power. So the large moving
 *            surface stays white and the colour gathers only as the panel nears the card.
 *   landing  closing only: the landed panel crossfades into the card over the last 100 ms, while
 *            the card's own text and icon slide back in ([navCardFace]).
 *
 * None of them runs on the transition's clock, though, and nor do the corners: each is read off the
 * panel's measured width as it draws, the timings above mapped through the bounds curve onto how
 * far the panel has got. The bounds animation starts only once the card has been laid out, which
 * on the way back is frames into the transition on a slow phone; layers on the clock ran on
 * without it, and the full-size screen washed white and pink before it had begun to shrink. On a
 * phone that keeps up, the two readings are the same.
 */

/** Length of the bounds animation, matching the web's `PANEL_MS`. */
const val NAV_CARD_MORPH_MILLIS = 250

/**
 * The web's `--ease-ios-spring`: it overshoots its approach rather than crawling the last few
 * percent, which is what made `ease-out` read as a stall on landing.
 */
private val MorphEasing = IosSpringEasing

/** How sharply the tint gathers towards the card end of the morph. */
private const val TINT_POWER = 4

/** The closing crossfade from landed panel to card, the web's `LAND_FADE_MS`. */
private const val LAND_FADE_MILLIS = 100

/** The web mask's leave curve: almost all of its opacity in the first few frames. */
private val MaskCloseEasing = CubicBezierEasing(0f, 0.95f, 0.2f, 1f)

private const val MASK_OPEN_DELAY_MILLIS = 50
private const val MASK_OPEN_MILLIS = 100

/** The web's `MASK_MS`: outlives the shrink so the mask is never gone before the card is back. */
private const val MASK_CLOSE_MILLIS = NAV_CARD_MORPH_MILLIS + 50

/** The rail card's corner, which the screen's corners grow out of and collapse back into. */
private val CardCorner = 12.dp

private val MorphBounds = BoundsTransform { _, _ -> tween(NAV_CARD_MORPH_MILLIS, easing = MorphEasing) }

/**
 * The [SharedTransitionScope] the nav host runs in. Null outside one, in previews say, where the
 * morph modifiers do nothing.
 */
val LocalSharedTransitionScope = compositionLocalOf<SharedTransitionScope?> { null }

/** The enter/exit scope of the nav entry this composable is in. Null outside a nav host. */
val LocalNavAnimatedVisibilityScope = compositionLocalOf<AnimatedVisibilityScope?> { null }

/**
 * The rail cards' widths, by the destination each opens: what a screen's tint measures its panel
 * against. Provided by the nav host alongside [LocalSharedTransitionScope]; null outside one.
 */
class NavCardWidths {
    private val widths = mutableMapOf<Route, Int>()

    internal operator fun get(destination: Route): Int? = widths[destination]

    internal operator fun set(destination: Route, width: Int) {
        widths[destination] = width
    }
}

val LocalNavCardWidths = compositionLocalOf<NavCardWidths?> { null }

private data class NavCardMorphKey(val destination: Route)

/**
 * Marks a rail card as the start of the morph into [destination]. Apply it first in the card's
 * modifier chain, so the bounds it shares are the card's own.
 *
 * The card's face disappears the instant the morph starts, as on the web where it is already behind
 * the backdrop; on the way back, the destination's mask carries the card's colour down onto it.
 */
@Composable
fun Modifier.navCardMorphSource(destination: Route): Modifier {
    val sharedScope = LocalSharedTransitionScope.current ?: return this
    val visibilityScope = LocalNavAnimatedVisibilityScope.current ?: return this
    val cardWidths = LocalNavCardWidths.current

    return with(sharedScope) {
        this@navCardMorphSource.sharedBounds(
            sharedContentState = rememberSharedContentState(NavCardMorphKey(destination)),
            animatedVisibilityScope = visibilityScope,
            enter = EnterTransition.None,
            exit = ExitTransition.None,
            boundsTransform = MorphBounds,
            resizeMode = scaleToBounds(ContentScale.FillWidth, Alignment.TopCenter),
            // Under the destination for the whole morph: the destination's mask is what the eye
            // follows in both directions.
            zIndexInOverlay = 0f,
            clipInOverlayDuringTransition = OverlayClip(RoundedCornerShape(CardCorner)),
        ).onSizeChanged { cardWidths?.set(destination, it.width) }
    }
}

/**
 * The destination end of a rail card's morph: the root of the screen [destination] opens.
 *
 * @param enabled false for a screen that is only sometimes opened out of its source: it is then a
 *   plain box, and its own page transition carries it.
 * @param cardTint the face colour of an accent card, which the screen gathers into on its way back
 *   and out of on its way open. Null for a white card: the white mask is all it needs.
 */
@Composable
fun NavCardMorphTarget(
    destination: Route,
    cardTint: Color?,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    content: @Composable () -> Unit,
) {
    val sharedScope = LocalSharedTransitionScope.current
    val visibilityScope = LocalNavAnimatedVisibilityScope.current
    if (!enabled || sharedScope == null || visibilityScope == null) {
        Box(modifier) {
            content()
        }
        return
    }

    val transition = visibilityScope.transition
    val closing = transition.targetState == EnterExitState.PostExit

    // The morph is only for coming out of the card and going back into it. A page pushed over this
    // screen covers it with that page's own transition, and popping that page reveals it again;
    // neither involves the card, which isn't even on screen, so the mask and tint stay out of it.
    //
    // Covered rather than closing: still in the stack with something above it. Read off the stack
    // and not the transition, which runs to PostExit either way; and a predictive back from here
    // scrubs while this is still on top, which is closing.
    val backStack = LocalNavigator.current.backStack
    val covered = destination in backStack && backStack.lastOrNull() != destination
    // Whether it has opened before, saved with the entry: coming back from a page above, the screen
    // is revealed rather than opened.
    var opened by rememberSaveable { mutableStateOf(false) }
    LaunchedEffect(transition.currentState) {
        if (transition.currentState == EnterExitState.Visible) {
            opened = true
        }
    }
    val morphing = if (closing) !covered else !opened
    // The page it grows into, so the mask meets it rather than flashing white on the dark themes.
    val maskColor = MaterialTheme.colorScheme.surfaceContainerLowest

    // The layers read the panel's width as they draw. The shrink is only a layer scale, which
    // doesn't redraw the content, so this ticks a redraw on every frame the shared transition runs.
    val cardWidths = LocalNavCardWidths.current
    val panel = remember(cardWidths, destination) { MorphPanel { cardWidths?.get(destination) } }
    val animating = morphing && sharedScope.isTransitionActive
    val frame by produceState(0L, animating) {
        while (animating) {
            withFrameNanos { value = it }
        }
    }
    // Corners: the card's on the way in and out, square once the screen fills the display.
    val cornerClip = remember(panel) { MorphCornerClip(panel) }

    with(sharedScope) {
        Box(
            modifier = modifier
                .sharedBounds(
                    sharedContentState = rememberSharedContentState(NavCardMorphKey(destination)),
                    animatedVisibilityScope = visibilityScope,
                    enter = EnterTransition.None,
                    exit = ExitTransition.None,
                    boundsTransform = MorphBounds,
                    resizeMode = scaleToBounds(ContentScale.FillWidth, Alignment.TopCenter),
                    zIndexInOverlay = 1f,
                    clipInOverlayDuringTransition = if (morphing) cornerClip else SquareClip,
                )
                // Reading the frame is what redraws these as the panel shrinks.
                .graphicsLayer {
                    val progress = if (morphing && frame >= 0L) panel.progress() else null
                    alpha = progress?.let { navCardLandingAlpha(it, closing) } ?: 1f
                }
                .onGloballyPositioned { panel.coordinates = it }
                .drawWithContent {
                    drawContent()
                    val progress = if (morphing && frame >= 0L) panel.progress() else null
                    if (progress != null) {
                        drawRect(maskColor, alpha = navCardMaskAlpha(progress, closing))
                        if (cardTint != null) {
                            drawRect(cardTint, alpha = navCardTintAlpha(progress))
                        }
                    }
                },
        ) {
            content()
        }
    }
}

/**
 * How far a panel [panelWidth] wide on screen has got between the full [screenWidth], 0, and the
 * card's [cardWidth], 1. Null when there's no card to measure against.
 */
internal fun navCardMorphProgress(panelWidth: Float, screenWidth: Float, cardWidth: Float?): Float? {
    if (cardWidth == null || screenWidth <= cardWidth) {
        return null
    }
    return ((screenWidth - panelWidth) / (screenWidth - cardWidth)).coerceIn(0f, 1f)
}

/**
 * Where the web's clock stands, in ms since the morph began, once the panel is at [progress]: the
 * bounds curve run backwards.
 */
internal fun navCardMorphMillis(progress: Float, closing: Boolean): Float {
    val travelled = if (closing) progress else 1f - progress
    return NAV_CARD_MORPH_MILLIS * MorphEasing.inverse(travelled.coerceIn(0f, 1f))
}

/** The white mask's opacity with the panel at [progress]. */
internal fun navCardMaskAlpha(progress: Float, closing: Boolean): Float {
    val millis = navCardMorphMillis(progress, closing)
    return if (closing) {
        MaskCloseEasing.transform((millis / MASK_CLOSE_MILLIS).coerceIn(0f, 1f))
    } else {
        1f - FastOutSlowInEasing.transform(((millis - MASK_OPEN_DELAY_MILLIS) / MASK_OPEN_MILLIS).coerceIn(0f, 1f))
    }
}

/** The accent tint's opacity with the panel at [progress]: its nearness to the card, to the [TINT_POWER]. */
internal fun navCardTintAlpha(progress: Float): Float = progress.pow(TINT_POWER)

/** The panel's own opacity at [progress]: whole, until it crossfades into the card as it lands. */
internal fun navCardLandingAlpha(progress: Float, closing: Boolean): Float {
    if (!closing) {
        return 1f
    }
    val fadingFor = navCardMorphMillis(progress, closing = true) - (NAV_CARD_MORPH_MILLIS - LAND_FADE_MILLIS)
    return 1f - (fadingFor / LAND_FADE_MILLIS).coerceIn(0f, 1f)
}

/**
 * The x at which this easing reaches [value], for a curve that only rises. Its ends are exact: a
 * search can't find them where the curve is flat or steep.
 */
private fun Easing.inverse(value: Float): Float {
    if (value <= 0f) return 0f
    if (value >= 1f) return 1f
    var low = 0f
    var high = 1f
    repeat(24) {
        val mid = (low + high) / 2
        if (transform(mid) < value) low = mid else high = mid
    }
    return (low + high) / 2
}

/**
 * The morphing screen, read off its on-screen width: [progress] from 0 filling the display to 1 at
 * the card. Null until the screen has been placed and the card measured.
 */
private class MorphPanel(private val cardWidth: () -> Int?) {
    var coordinates: LayoutCoordinates? = null

    /** As it's drawn now, the shrink's scale included. */
    fun progress(): Float? {
        val coordinates = coordinates?.takeIf { it.isAttached } ?: return null
        val drawnWidth = coordinates.findRootCoordinates().localBoundingBoxOf(coordinates, clipBounds = false).width
        return progress(drawnWidth)
    }

    /** At [drawnWidth] on screen. */
    fun progress(drawnWidth: Float): Float? {
        val screenWidth = coordinates?.size?.width ?: return null
        return navCardMorphProgress(drawnWidth, screenWidth.toFloat(), cardWidth()?.toFloat())
    }
}

/**
 * Rounds the morphing screen's corners by how near it is to the card, from the bounds the overlay
 * is about to draw it at.
 */
private class MorphCornerClip(private val panel: MorphPanel) : SharedTransitionScope.OverlayClip {
    private val path = Path()

    override fun getClipPath(
        sharedContentState: SharedTransitionScope.SharedContentState,
        bounds: Rect,
        layoutDirection: LayoutDirection,
        density: Density,
    ): Path {
        val radius = with(density) { CardCorner.toPx() } * (panel.progress(bounds.width) ?: 0f)
        path.reset()
        path.addRoundRect(RoundRect(bounds, CornerRadius(radius)))
        return path
    }
}

/** The screen's clip when it isn't morphing: square, as it fills the display. */
private object SquareClip : SharedTransitionScope.OverlayClip {
    private val path = Path()

    override fun getClipPath(
        sharedContentState: SharedTransitionScope.SharedContentState,
        bounds: Rect,
        layoutDirection: LayoutDirection,
        density: Density,
    ): Path {
        path.reset()
        path.addRect(bounds)
        return path
    }
}

/** Which part of a rail card's face, for [navCardFace]. */
enum class NavCardFacePart {
    /** The title and subtitle: slide up out of the card. */
    TEXT,

    /** The icon in its corner circle: slides down out of the card. */
    ICON,
}

/** How far the text travels, enough to clear the subtitle: the web's `-translate-y-20`. */
private val FaceTextTravel = 80.dp

/** Tailwind's `ease-in-out`, which the face slides on. */
private val FaceEasing = CubicBezierEasing(0.4f, 0f, 0.2f, 1f)

private const val FACE_MILLIS = 200

/** On closing the panel lands as a blank card first; the face slides in as it clears. */
private const val FACE_TEXT_DELAY_MILLIS = 150
private const val FACE_ICON_DELAY_MILLIS = 200

/**
 * Slides part of a rail card's face out as the card morphs away, and back in after the screen has
 * landed on it. Only during a shared-bounds transition: any other navigation away from the screen
 * the card is on leaves its face alone.
 */
@Composable
fun Modifier.navCardFace(part: NavCardFacePart): Modifier {
    val sharedScope = LocalSharedTransitionScope.current ?: return this
    val visibilityScope = LocalNavAnimatedVisibilityScope.current ?: return this
    if (!sharedScope.isTransitionActive) {
        return this
    }

    val travel = with(LocalDensity.current) { FaceTextTravel.roundToPx() }
    val delay = if (part == NavCardFacePart.TEXT) FACE_TEXT_DELAY_MILLIS else FACE_ICON_DELAY_MILLIS
    val offset: (Int) -> Int = { height -> if (part == NavCardFacePart.TEXT) -travel else height }

    return with(visibilityScope) {
        this@navCardFace.animateEnterExit(
            enter = slideInVertically(tween(FACE_MILLIS, delayMillis = delay, easing = FaceEasing), offset),
            exit = slideOutVertically(tween(FACE_MILLIS, easing = FaceEasing), offset),
        )
    }
}

/** The screen underneath fades most of the way out, as behind the web's `bg-white/90` backdrop. */
private const val BACKDROP_ALPHA = 0.1f

/** How long that backdrop fade takes, the web's `duration-200`. */
private const val BACKDROP_MILLIS = 200

/**
 * Nav entry metadata for a screen opened by a rail card's morph. Pass it as the `metadata` of the
 * destination's `entry<…>`: the screen on top supplies the transition both ways, so this covers the
 * push, the pop and the predictive back gesture.
 *
 * Neither scene slides, so the shared bounds are the only thing that moves. The screen underneath
 * fades most of the way out behind the morph, as behind the web's backdrop.
 */
fun navCardMorphMetadata(): Map<String, Any> {
    return NavDisplay.transitionSpec { navCardMorphOpen() } +
        NavDisplay.popTransitionSpec { navCardMorphClose() } +
        NavDisplay.predictivePopTransitionSpec { navCardMorphClose() }
}

/** The morph's opening scene change: only the shared bounds move, the screen underneath fades. */
internal fun navCardMorphOpen(): ContentTransform =
    EnterTransition.None togetherWith fadeOut(tween(BACKDROP_MILLIS), targetAlpha = BACKDROP_ALPHA)

/**
 * The morph's closing scene change. No exit of its own: the destination stays composed for as long
 * as its morph animations run, which is exactly as long as it is needed.
 */
internal fun navCardMorphClose(): ContentTransform =
    fadeIn(tween(BACKDROP_MILLIS), initialAlpha = BACKDROP_ALPHA) togetherWith ExitTransition.None
