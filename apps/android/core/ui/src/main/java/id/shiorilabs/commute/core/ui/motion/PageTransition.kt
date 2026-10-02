package id.shiorilabs.commute.core.ui.motion

import androidx.compose.animation.ContentTransform
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.togetherWith
import androidx.navigation3.scene.Scene
import androidx.navigation3.ui.NavDisplay

/**
 * How long a page takes to slide across. Longer than the web pane's 250 ms, since a page travels
 * the phone's full width rather than a pane's.
 */
const val PAGE_MILLIS = 300

/** The web's sheet and pane curve: quick off the mark, a long settle. */
val PageEasing = CubicBezierEasing(0.32f, 0.72f, 0f, 1f)

/** How far the page underneath drifts the other way, as a fraction of its width. */
private const val UNDERNEATH_DRIFT = 4

/** The page underneath dims a little as it is covered, so the edge of the new page reads. */
private const val UNDERNEATH_ALPHA = 0.6f

private fun <T> pageTween() = tween<T>(PAGE_MILLIS, easing = PageEasing)

/** In a fade-through, how long the screen leaving takes to go, before the other starts to show. */
private const val FADE_OUT_MILLIS = 120

/** The metadata key [sharedElementSourceMetadata] sets. */
private const val SHARED_ELEMENT_SOURCE = "commute.sharedElementSource"

/**
 * Nav entry metadata for a screen whose content flies into the pages it opens as shared elements,
 * like the home feed's station names and line cards. A page from [pageTransitionMetadata] opened
 * from it fades rather than slides, so the shared elements are the only thing that moves.
 */
fun sharedElementSourceMetadata(): Map<String, Any> = mapOf(SHARED_ELEMENT_SOURCE to true)

private fun Scene<*>.isSharedElementSource(): Boolean = metadata[SHARED_ELEMENT_SOURCE] == true

/**
 * Nav entry metadata for a page pushed over the current screen, like a station page: it slides in
 * from the trailing edge while the screen underneath drifts back and dims, and slides out the same
 * way on back. Pass it as the `metadata` of the page's `entry<…>`; the screen on top supplies the
 * transition both ways, so this covers the push, the pop and the predictive back gesture, which
 * scrubs the pop.
 *
 * Over a [sharedElementSourceMetadata] screen the two fade through each other in place instead,
 * and the shared elements carry the motion. Sliding the page as well would drag them sideways in
 * mid-flight. The screen leaving fades out quickly and the one arriving only fades in once it has
 * gone, so what flies crosses an almost empty page rather than over the other screen's text.
 *
 * Without it a page gets Navigation 3's default, a 700 ms crossfade with both screens see-through
 * at once.
 */
fun pageTransitionMetadata(): Map<String, Any> {
    val push = {
        slideInHorizontally(pageTween()) { width -> width } togetherWith
            (slideOutHorizontally(pageTween()) { width -> -width / UNDERNEATH_DRIFT } + fadeOut(pageTween(), UNDERNEATH_ALPHA))
    }
    val pop: () -> ContentTransform = {
        (slideInHorizontally(pageTween()) { width -> -width / UNDERNEATH_DRIFT } + fadeIn(pageTween(), UNDERNEATH_ALPHA)) togetherWith
            slideOutHorizontally(pageTween()) { width -> width }
    }
    val crossfade = {
        fadeIn(tween(PAGE_MILLIS - FADE_OUT_MILLIS, delayMillis = FADE_OUT_MILLIS, easing = PageEasing)) togetherWith
            fadeOut(tween(FADE_OUT_MILLIS))
    }
    return NavDisplay.transitionSpec { if (initialState.isSharedElementSource()) crossfade() else push() } +
        NavDisplay.popTransitionSpec { if (targetState.isSharedElementSource()) crossfade() else pop() } +
        NavDisplay.predictivePopTransitionSpec { if (targetState.isSharedElementSource()) crossfade() else pop() }
}
