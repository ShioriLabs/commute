package id.shiorilabs.commute.feature.saved.presentation.components

import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import id.shiorilabs.commute.core.navigation.Route
import id.shiorilabs.commute.core.ui.ext.NAV_STAGGER_OFFSET_MILLIS
import id.shiorilabs.commute.core.ui.ext.NAV_STAGGER_STEP_MILLIS
import id.shiorilabs.commute.core.ui.ext.navEntrance
import id.shiorilabs.commute.core.ui.icons.CommuteIcons
import id.shiorilabs.commute.core.ui.morph.LocalNavAnimatedVisibilityScope
import id.shiorilabs.commute.core.ui.morph.LocalSharedTransitionScope
import id.shiorilabs.commute.core.ui.morph.navCardMorphSource
import id.shiorilabs.commute.core.ui.motion.PageEasing
import id.shiorilabs.commute.core.ui.preview.CommutePreviewScaffold
import id.shiorilabs.commute.feature.saved.R

/** Where the rail's backdrop turns from transparent to the solid page background. */
private const val BACKDROP_SOLID_FROM = 0.5f

/**
 * The home screen's bottom rail of entry points, over a backdrop that fades the list out beneath
 * it. It scrolls horizontally so it keeps working once it holds more cards than fit a phone.
 *
 * The cards rise in one after another the first time the screen shows, as on the web. With
 * [slidesWithPage] they also drop off the bottom edge one after another as a page covers the home
 * screen, and come back the same way; meanwhile the rail draws above the shared elements in flight,
 * so a line card that was under it on the feed leaves from under it and lands back under it.
 *
 * @param bottomInset the system navigation bar's height, kept clear below the cards.
 */
@Composable
fun HomeNavRail(
    onSearchClick: () -> Unit,
    onSettingsClick: () -> Unit,
    modifier: Modifier = Modifier,
    bottomInset: Dp = 0.dp,
    slidesWithPage: Boolean = true,
) {

    val background = MaterialTheme.colorScheme.background
    val railDescription = stringResource(R.string.saved_nav_rail_description)

    Row(
        modifier = modifier
            .then(if (slidesWithPage) Modifier.aboveSharedElements() else Modifier)
            .fillMaxWidth()
            .background(
                Brush.verticalGradient(
                    0f to Color.Transparent,
                    BACKDROP_SOLID_FROM to background,
                    1f to background,
                ),
            )
            .semantics { contentDescription = railDescription }
            .horizontalScroll(rememberScrollState())
            .padding(start = 16.dp, top = 16.dp, end = 16.dp, bottom = 16.dp + bottomInset),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        // Each card rides a wrapper rather than its own modifiers: the search card's chain starts
        // with its morph, which has to measure the card where it really stands.
        Box(Modifier.navEntrance(0).navRailCardTransition(0, enabled = slidesWithPage)) {
            NavRailCard(
                title = stringResource(R.string.saved_nav_search_title),
                subtitle = stringResource(R.string.saved_nav_search_subtitle),
                description = stringResource(R.string.saved_nav_search_description),
                icon = CommuteIcons.Search,
                onClick = onSearchClick,
                // First in the card's chain, so the bounds the morph starts from are the card's own.
                modifier = Modifier.navCardMorphSource(Route.Search),
                accent = true,
                animateFace = !slidesWithPage,
            )
        }
        Box(Modifier.navEntrance(1).navRailCardTransition(1, enabled = slidesWithPage)) {
            NavRailCard(
                title = stringResource(R.string.saved_nav_settings_title),
                subtitle = stringResource(R.string.saved_nav_settings_subtitle),
                description = stringResource(R.string.saved_nav_settings_description),
                icon = CommuteIcons.Settings,
                onClick = onSettingsClick,
                modifier = Modifier.navCardMorphSource(Route.Settings),
                animateFace = !slidesWithPage,
            )
        }
    }
}

/**
 * Draws the rail in the shared-transition overlay while a transition runs, above the elements in
 * flight, which draw there too and would otherwise cover it. Up there the home screen's own fade no
 * longer reaches it, so the rail fades itself, backdrop included: out as quickly as the home screen
 * does, so it doesn't hang over the card climbing out from under it as a ghost, and back in as the
 * home screen returns.
 *
 * Not for search's morph, whose card has to stay underneath the screen it opens into.
 */
@Composable
private fun Modifier.aboveSharedElements(): Modifier {
    val sharedScope = LocalSharedTransitionScope.current ?: return this
    val visibilityScope = LocalNavAnimatedVisibilityScope.current ?: return this
    return with(sharedScope) {
        with(visibilityScope) {
            this@aboveSharedElements
                .renderInSharedTransitionScopeOverlay(zIndexInOverlay = RAIL_OVERLAY_Z)
                .animateEnterExit(
                    enter = fadeIn(tween(CARD_SLIDE_MILLIS, easing = PageEasing)),
                    exit = fadeOut(tween(RAIL_FADE_OUT_MILLIS)),
                )
        }
    }
}

/** The home screen's own fade-out in a fade-through (PageTransition's FADE_OUT_MILLIS). */
private const val RAIL_FADE_OUT_MILLIS = 120

/** Above the shared elements, which sit at 0. */
private const val RAIL_OVERLAY_Z = 1f

/** How long a rail card takes to drop off the edge, or come back. */
private const val CARD_SLIDE_MILLIS = 300

/**
 * One rail card dropping off the bottom edge as a page covers the home screen and rising back as
 * it goes, [index] places after the first: the web's nav stagger, run both ways. Coming back it
 * waits the web's offset too, so the page has mostly cleared before the rail returns.
 */
@Composable
private fun Modifier.navRailCardTransition(index: Int, enabled: Boolean): Modifier {
    if (!enabled) {
        return this
    }
    val visibilityScope = LocalNavAnimatedVisibilityScope.current ?: return this
    // Clear of the backdrop's padding and the navigation bar, whatever the card's height.
    val offscreen = { height: Int -> height * 2 }
    val step = index.coerceAtMost(NAV_MAX_STAGGER) * NAV_STAGGER_STEP_MILLIS
    return with(visibilityScope) {
        this@navRailCardTransition.animateEnterExit(
            enter = slideInVertically(
                tween(CARD_SLIDE_MILLIS, delayMillis = NAV_STAGGER_OFFSET_MILLIS + step, easing = PageEasing),
                offscreen,
            ),
            exit = slideOutVertically(tween(CARD_SLIDE_MILLIS, delayMillis = step, easing = PageEasing), offscreen),
        )
    }
}

/** Past this many cards they share a delay, as the web caps NAV_STAGGER. */
private const val NAV_MAX_STAGGER = 4

@Preview(showBackground = true)
@Composable
private fun HomeNavRailPreview() {
    CommutePreviewScaffold {
        HomeNavRail(
            onSearchClick = {},
            onSettingsClick = {},
        )
    }
}
