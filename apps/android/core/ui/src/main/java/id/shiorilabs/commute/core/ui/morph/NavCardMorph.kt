package id.shiorilabs.commute.core.ui.morph

import androidx.compose.animation.AnimatedVisibilityScope
import androidx.compose.animation.BoundsTransform
import androidx.compose.animation.EnterExitState
import androidx.compose.animation.EnterTransition
import androidx.compose.animation.ExitTransition
import androidx.compose.animation.SharedTransitionScope
import androidx.compose.animation.SharedTransitionScope.ResizeMode.Companion.scaleToBounds
import androidx.compose.animation.core.CubicBezierEasing
import id.shiorilabs.commute.core.ui.motion.IosSpringEasing
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.animateDp
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.snap
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalDensity
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
 *            panel's SIZE rather than the clock: how close it is to card size, to the 4th power. So
 *            the large moving surface stays white and the colour gathers only as the panel nears
 *            the card. Tied to the clock it lagged the shape, and closing shrank as a white ghost.
 *   landing  closing only: the landed panel crossfades into the card over the last 100 ms, while
 *            the card's own text and icon slide back in ([navCardFace]).
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
        )
    }
}

/**
 * The destination end of a rail card's morph: the root of the screen [destination] opens.
 *
 * @param cardTint the face colour of an accent card, which the screen gathers into on its way back
 *   and out of on its way open. Null for a white card: the white mask is all it needs.
 */
@Composable
fun NavCardMorphTarget(
    destination: Route,
    cardTint: Color?,
    modifier: Modifier = Modifier,
    content: @Composable () -> Unit,
) {
    val sharedScope = LocalSharedTransitionScope.current
    val visibilityScope = LocalNavAnimatedVisibilityScope.current
    if (sharedScope == null || visibilityScope == null) {
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

    // Corners: the card's on the way in and out, square once the screen fills the display.
    val corner by transition.animateDp(
        transitionSpec = { tween(NAV_CARD_MORPH_MILLIS, easing = MorphEasing) },
        label = "navCardMorphCorner",
    ) { state -> if (state == EnterExitState.Visible) 0.dp else CardCorner }

    val maskAlpha by transition.animateFloat(
        transitionSpec = {
            if (targetState == EnterExitState.Visible) {
                tween(MASK_OPEN_MILLIS, delayMillis = MASK_OPEN_DELAY_MILLIS)
            } else {
                tween(MASK_CLOSE_MILLIS, easing = MaskCloseEasing)
            }
        },
        label = "navCardMorphMask",
    ) { state -> if (state == EnterExitState.Visible) 0f else 1f }

    // The morph's clock, 0 → 1 over the bounds animation in either direction. The tint is derived
    // from where the panel's size is at that moment, so it runs on the same duration and curve.
    val clock by transition.animateFloat(
        transitionSpec = { tween(NAV_CARD_MORPH_MILLIS, easing = LinearEasing) },
        label = "navCardMorphClock",
    ) { state -> if (state == EnterExitState.Visible) 1f else 0f }
    val tintAlpha = if (cardTint == null) 0f else navCardTintAlpha(clock, closing)

    val landingAlpha by transition.animateFloat(
        transitionSpec = {
            if (targetState == EnterExitState.PostExit) {
                tween(LAND_FADE_MILLIS, delayMillis = NAV_CARD_MORPH_MILLIS - LAND_FADE_MILLIS, easing = LinearEasing)
            } else {
                snap()
            }
        },
        label = "navCardMorphLanding",
    ) { state -> if (state == EnterExitState.PostExit) 0f else 1f }

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
                    clipInOverlayDuringTransition = OverlayClip(RoundedCornerShape(if (morphing) corner else 0.dp)),
                )
                .graphicsLayer { alpha = if (morphing) landingAlpha else 1f },
        ) {
            content()
            if (morphing && maskAlpha > 0f) {
                Box(
                    Modifier
                        .matchParentSize()
                        .graphicsLayer { alpha = maskAlpha }
                        .background(Color.White),
                )
            }
            if (morphing && cardTint != null && tintAlpha > 0f) {
                Box(
                    Modifier
                        .matchParentSize()
                        .graphicsLayer { alpha = tintAlpha }
                        .background(cardTint),
                )
            }
        }
    }
}

/**
 * The accent tint's opacity [clock] of the way through the morph: how close the panel is to card
 * size, to the [TINT_POWER]. Opening, the panel leaves the card along the morph curve; closing, it
 * approaches it along the same curve run from the other end.
 */
internal fun navCardTintAlpha(clock: Float, closing: Boolean): Float {
    val towardsCard = if (closing) MorphEasing.transform(1f - clock) else 1f - MorphEasing.transform(clock)
    return towardsCard.coerceIn(0f, 1f).pow(TINT_POWER)
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
    val open = {
        EnterTransition.None togetherWith fadeOut(tween(BACKDROP_MILLIS), targetAlpha = BACKDROP_ALPHA)
    }
    val close = {
        // No exit of its own: the destination stays composed for as long as its morph animations
        // run, which is exactly as long as it is needed.
        fadeIn(tween(BACKDROP_MILLIS), initialAlpha = BACKDROP_ALPHA) togetherWith ExitTransition.None
    }
    return NavDisplay.transitionSpec { open() } +
        NavDisplay.popTransitionSpec { close() } +
        NavDisplay.predictivePopTransitionSpec { close() }
}
